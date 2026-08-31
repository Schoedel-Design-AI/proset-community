import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  StyleSheet,
  Text,
  View,
  ScrollView,
  Pressable,
  TextInput,
  Platform,
  Alert,
  ActivityIndicator,
  Modal,
  FlatList,
  RefreshControl,
} from "react-native";
import { router, useLocalSearchParams } from "@/lib/navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@react-native-vector-icons/feather/static";
import * as Haptics from "@/lib/haptics";
import * as Clipboard from "@/lib/clipboard";
import * as Sharing from "@/lib/sharing";
import * as FileSystem from "@/lib/file-system";
import { useFileDownload } from "@/lib/use-file-download";
import Colors from "@/constants/colors";
import { getApiUrl, getAuthHeaders } from "@/lib/query-client";
import { useResponsiveLayout } from "@/lib/useResponsiveLayout";
import { useAuth } from "@/lib/auth-context";
import AvatarView from "@/components/AvatarView";
import { useLanguage } from "@/lib/i18n";
import { formatDate } from "@/lib/utils";
import { useTextScale, sf, type TextScale } from "@/lib/typography";

type Folder = {
  id: string;
  name: string;
  parentId: string | null;
  isSystem: number;
  fileCount: number;
  createdAt: string;
  updatedAt: string;
};

type FileItem = {
  id: string;
  name: string;
  conversionType: string | null;
  content: string;
  fileSize: number;
  mimeType: string;
  folderId: string | null;
  sourceRecordingId: string | null;
  createdAt: string;
  updatedAt: string;
};

type StorageInfo = {
  used: number;
  limit: number;
  fileCount: number;
  bucketFileCount: number;
  percentage: number;
};

const FOLDER_ICONS: Record<string, string> = {
  "Summary": "file-text",
  "Email": "mail",
  "Blog Post": "edit-3",
  "Bullet Points": "list",
  "To-Do List": "check-square",
  "Calendar Event": "calendar",
  "LinkedIn Post": "linkedin",
  "AI Prompt": "cpu",
  "Questions": "help-circle",
  "Plan": "map",
  "Requirements": "clipboard",
  "Quick Research": "search",
  "Spreadsheet": "grid",
  "Linux Commands": "terminal",
  "Python Script": "code",
  "Academic Research (Asst.)": "book-open",
  "Academic Research": "book-open",
  "Notes": "edit",
  "Outline": "layers",
  "Combined": "git-merge",
};

function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

export default function FilesScreen() {
  const { fileId } = useLocalSearchParams<{ fileId?: string }>();
  const insets = useSafeAreaInsets();
  const layout = useResponsiveLayout();
  const { user } = useAuth();
  const { t, language } = useLanguage();
  // Shared download interaction: busy state, duplicate-tap guard, real outcome
  // ("Saved to Downloads" vs "File saved"), and recovery actions on failure.
  const { save: saveFile, busyId: savingFileId } = useFileDownload((fileName, messageKey) => {
    if (Platform.OS !== "web") Alert.alert(t(messageKey as any), fileName);
  });
  const ts = useTextScale();
  const styles = useMemo(() => makeStyles(ts), [ts]);
  const baseUrl = getApiUrl();

  const [folders, setFolders] = useState<Folder[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"folders" | "files">("folders");
  const [selectedFile, setSelectedFile] = useState<FileItem | null>(null);
  const [showFileDetail, setShowFileDetail] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [moveFileId, setMoveFileId] = useState<string | null>(null);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string; type: "file" | "folder" } | null>(null);
  const [renameName, setRenameName] = useState("");
  const [actionMenuTarget, setActionMenuTarget] = useState<{ type: "file"; file: FileItem } | { type: "folder"; folder: Folder } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const openedDeepLinkRef = useRef<string | null>(null);

  const canUseBrowserBack = Platform.OS !== "web"
    ? router.canGoBack()
    : (() => {
        if (typeof window === "undefined") return false;
        const historyState = window.history.state as { idx?: number } | null;
        if (typeof historyState?.idx === "number") {
          return historyState.idx > 0;
        }
        return typeof document !== "undefined"
          && document.referrer.startsWith(window.location.origin)
          && window.history.length > 1;
      })();

  const fetchData = useCallback(async () => {
    if (!user) return;
    try {
      const [foldersRes, storageRes] = await Promise.all([
        globalThis.fetch(new URL("/api/folders", baseUrl).toString(), { credentials: "include", headers: getAuthHeaders() }),
        globalThis.fetch(new URL("/api/storage", baseUrl).toString(), { credentials: "include", headers: getAuthHeaders() }),
      ]);
      if (foldersRes.ok) {
        const foldersData = await foldersRes.json();
        setFolders(foldersData);
        if (storageRes.ok) {
          const raw = await storageRes.json();
          const limitBytes = typeof raw.limit === "number"
            ? raw.limit
            : typeof raw.storageMb === "number"
              ? raw.storageMb * 1024 * 1024
              : 0;
          const usedBytes = typeof raw.totalUsed === "number"
            ? raw.totalUsed
            : typeof raw.used === "number" ? raw.used : 0;
          const fileCount = typeof raw.fileCount === "number"
            ? raw.fileCount
            : Array.isArray(foldersData)
              ? foldersData.reduce((sum: number, f: Folder) => sum + (f.fileCount || 0), 0)
              : 0;
          const bucketFileCount = typeof raw.bucketFileCount === "number" ? raw.bucketFileCount : 0;
          const percentage = typeof raw.percentage === "number"
            ? (typeof raw.totalPercentage === "number" ? raw.totalPercentage : raw.percentage)
            : limitBytes > 0 ? Math.round((usedBytes / limitBytes) * 100) : 0;
          setStorageInfo({ used: usedBytes, limit: limitBytes, fileCount, bucketFileCount, percentage });
        }
      } else if (storageRes.ok) {
        // Drain the response to avoid leaking the connection.
        await storageRes.json().catch(() => null);
      }
    } catch (err) {
      console.error("Failed to load files data:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user, baseUrl]);

  const fetchFiles = useCallback(async (folderId?: string | null) => {
    if (!user) return;
    try {
      let url = new URL("/api/files", baseUrl);
      if (folderId === "unfiled") {
        url.searchParams.set("folderId", "unfiled");
      } else if (folderId) {
        url.searchParams.set("folderId", folderId);
      }
      const res = await globalThis.fetch(url.toString(), { credentials: "include", headers: getAuthHeaders() });
      if (res.ok) setFiles(await res.json());
    } catch (err) {
      console.error("Failed to load files:", err);
    }
  }, [user, baseUrl]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!user || !fileId || openedDeepLinkRef.current === fileId) return;
    openedDeepLinkRef.current = fileId;
    globalThis.fetch(new URL(`/api/files/${encodeURIComponent(fileId)}`, baseUrl).toString(), {
      credentials: "include",
      headers: getAuthHeaders(),
    }).then(async (response) => {
      if (!response.ok) throw new Error("Saved conversion not found.");
      const file = await response.json() as FileItem;
      setSelectedFolder(file.folderId || "unfiled");
      setViewMode("files");
      setSelectedFile(file);
      setShowFileDetail(true);
    }).catch(() => {
      openedDeepLinkRef.current = null;
    });
  }, [baseUrl, fileId, user]);

  useEffect(() => {
    if (viewMode === "files" || selectedFolder) {
      fetchFiles(selectedFolder);
    }
  }, [viewMode, selectedFolder, fetchFiles]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchData();
    if (selectedFolder) fetchFiles(selectedFolder);
  }, [fetchData, fetchFiles, selectedFolder]);

  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) return files;
    const q = searchQuery.toLowerCase();
    return files.filter(f =>
      f.name.toLowerCase().includes(q) ||
      (f.conversionType && f.conversionType.toLowerCase().includes(q))
    );
  }, [files, searchQuery]);

  const systemFolders = useMemo(() => folders.filter(f => f.isSystem === 1 && f.fileCount > 0 && !f.parentId), [folders]);
  const customFolders = useMemo(() => folders.filter(f => f.isSystem === 0 && !f.parentId), [folders]);
  const subFolders = useMemo(() => {
    if (!selectedFolder) return [];
    return folders.filter(f => f.parentId === selectedFolder);
  }, [folders, selectedFolder]);
  const storageCountLabel = useMemo(() => {
    if (!storageInfo) return "";
    const textLabel = language === "es" ? "Archivos de texto" : "Text files";
    const cloudLabel = language === "es" ? "Archivos en la nube" : "Cloud files";
    const parts = [`${textLabel}: ${storageInfo.fileCount}`];
    if (storageInfo.bucketFileCount > 0) {
      parts.push(`${cloudLabel}: ${storageInfo.bucketFileCount}`);
    }
    return parts.join(" · ");
  }, [language, storageInfo]);

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    setActionLoading(true);
    try {
      const bodyData: any = { name: newFolderName.trim() };
      if (selectedFolder) bodyData.parentId = selectedFolder;
      const res = await globalThis.fetch(new URL("/api/folders", baseUrl).toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(bodyData),
      });
      if (res.ok) {
        Platform.OS !== "web" && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setNewFolderName("");
        setShowNewFolder(false);
        fetchData();
      }
    } catch {
      Alert.alert(t("common.error"), t("common.somethingWentWrong"));
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeleteFolder = (folder: Folder) => {
    if (folder.isSystem) {
      Alert.alert(t("common.error"), t("files.cannotDeleteSystem"));
      return;
    }
    Alert.alert(t("files.deleteFolder"), t("files.deleteFolderDesc"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"), style: "destructive", onPress: async () => {
          try {
            await globalThis.fetch(new URL(`/api/folders/${folder.id}`, baseUrl).toString(), {
              method: "DELETE", credentials: "include",
            });
            Platform.OS !== "web" && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            fetchData();
          } catch {
            Alert.alert(t("common.error"), t("common.somethingWentWrong"));
          }
        },
      },
    ]);
  };

  const handleDeleteFile = (file: FileItem) => {
    Alert.alert(t("files.deleteFile"), t("files.deleteFileDesc"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"), style: "destructive", onPress: async () => {
          try {
            await globalThis.fetch(new URL(`/api/files/${file.id}`, baseUrl).toString(), {
              method: "DELETE", credentials: "include",
            });
            Platform.OS !== "web" && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setFiles(prev => prev.filter(f => f.id !== file.id));
            if (showFileDetail && selectedFile?.id === file.id) {
              setShowFileDetail(false);
              setSelectedFile(null);
            }
            fetchData();
          } catch {
            Alert.alert(t("common.error"), t("common.somethingWentWrong"));
          }
        },
      },
    ]);
  };

  const handleMoveFile = async (targetFolderId: string | null) => {
    if (!moveFileId) return;
    setActionLoading(true);
    try {
      const res = await globalThis.fetch(new URL(`/api/files/${moveFileId}`, baseUrl).toString(), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ folderId: targetFolderId }),
      });
      if (res.ok) {
        Platform.OS !== "web" && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setShowMoveModal(false);
        setMoveFileId(null);
        fetchFiles(selectedFolder);
        fetchData();
      }
    } catch {
      Alert.alert(t("common.error"), t("common.somethingWentWrong"));
    } finally {
      setActionLoading(false);
    }
  };

  const handleRename = async () => {
    if (!renameTarget || !renameName.trim()) return;
    setActionLoading(true);
    try {
      const endpoint = renameTarget.type === "folder" ? `/api/folders/${renameTarget.id}` : `/api/files/${renameTarget.id}`;
      const res = await globalThis.fetch(new URL(endpoint, baseUrl).toString(), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ name: renameName.trim() }),
      });
      if (res.ok) {
        Platform.OS !== "web" && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setShowRenameModal(false);
        setRenameTarget(null);
        setRenameName("");
        fetchData();
        if (selectedFolder) fetchFiles(selectedFolder);
      } else {
        const data = await res.json();
        Alert.alert(t("common.error"), data.error || t("common.somethingWentWrong"));
      }
    } catch {
      Alert.alert(t("common.error"), t("common.somethingWentWrong"));
    } finally {
      setActionLoading(false);
    }
  };

  const handleCopyContent = async (file: FileItem) => {
    try {
      await Clipboard.setStringAsync(file.content);
      Platform.OS !== "web" && Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(t("common.copy"), t("files.copiedToClipboard"));
    } catch {
      Alert.alert(t("common.error"), t("common.somethingWentWrong"));
    }
  };

  const handleShareFile = async (file: FileItem) => {
    try {
      if (Platform.OS === "web") {
        const blob = new Blob([file.content], { type: "text/plain" });
        const fileName = `${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}.txt`;
        let shared = false;
        try {
          if (navigator.share && navigator.canShare) {
            const shareFile = new File([blob], fileName, { type: "text/plain" });
            const shareData = { files: [shareFile] };
            if (navigator.canShare(shareData)) {
              await navigator.share(shareData);
              shared = true;
            }
          }
        } catch (err: any) {
          if (err?.name === "AbortError") shared = true;
        }
        if (!shared) {
          await Clipboard.setStringAsync(file.content);
          Alert.alert(t("common.copy"), t("files.copiedToClipboard"));
        }
        return;
      }
      const filePath = `${FileSystem.cacheDirectory}${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}.txt`;
      await FileSystem.writeAsStringAsync(filePath, file.content);
      await Sharing.shareAsync(filePath, { mimeType: "text/plain", dialogTitle: file.name });
    } catch {
      Alert.alert(t("common.error"), t("common.somethingWentWrong"));
    }
  };

  const handleDownloadFile = async (file: FileItem) => {
    await saveFile({
      fileName: `${file.name}.txt`,
      mimeType: "text/plain",
      text: file.content,
      dialogTitle: file.name,
    }, `file-${file.id}`);
  };

  const openFolder = (folderId: string) => {
    setSelectedFolder(folderId);
    setViewMode("files");
    setSearchQuery("");
  };

  const goBack = () => {
    if (selectedFolder) {
      const currentFolder = folders.find(f => f.id === selectedFolder);
      if (currentFolder?.parentId) {
        setSelectedFolder(currentFolder.parentId);
        setFiles([]);
        setSearchQuery("");
        fetchFiles(currentFolder.parentId);
      } else {
        setSelectedFolder(null);
        setViewMode("folders");
        setFiles([]);
        setSearchQuery("");
      }
    } else {
      if (canUseBrowserBack) {
        router.back();
      } else {
        router.replace("/");
      }
    }
  };

  const showFolderActions = (folder: Folder) => {
    if (folder.isSystem) return;
    Platform.OS !== "web" && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setActionMenuTarget({ type: "folder", folder });
  };

  const showFileActions = (file: FileItem) => {
    Platform.OS !== "web" && Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setActionMenuTarget({ type: "file", file });
  };

  const topPadding = Platform.OS === "web" ? 67 : insets.top;

  if (loading) {
    return (
      <View style={[styles.container, { paddingTop: topPadding }]}>
        <ActivityIndicator size="large" color={Colors.primary} style={{ marginTop: 40 }} />
      </View>
    );
  }

  const renderFolderItem = (folder: Folder) => {
    const iconName = FOLDER_ICONS[folder.name] || "folder";
    return (
      <Pressable
        key={folder.id}
        style={({ pressed }) => [styles.folderCard, pressed && { opacity: 0.7 }]}
        onPress={() => openFolder(folder.id)}
        onLongPress={() => showFolderActions(folder)}
        accessibilityRole="button"
        accessibilityLabel={t("files.folderAccessibility", { name: folder.name, count: String(folder.fileCount) })}
      >
        <View style={[styles.folderIconWrap, folder.isSystem ? styles.systemFolderIcon : styles.customFolderIcon]}>
          <Feather name={iconName as any} size={20} color={folder.isSystem ? Colors.primary : Colors.warning} />
        </View>
        <View style={styles.folderInfo}>
          <Text style={[styles.folderName, { fontSize: ts.bodyLarge }]} numberOfLines={1}>{folder.name}</Text>
          <Text style={[styles.folderMeta, { fontSize: ts.caption }]}>
            {folder.fileCount === 1 ? t("files.fileCountSingular", { count: "1" }) : t("files.fileCount", { count: String(folder.fileCount) })}
            {folder.isSystem ? ` · ${t("files.systemFolder")}` : ""}
          </Text>
        </View>
        <View style={styles.rowActions}>
          {!folder.isSystem && (
            <Pressable
              onPress={(e) => { e.stopPropagation?.(); showFolderActions(folder); }}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={language === "es" ? "Más acciones" : "More actions"}
              style={({ pressed }) => [styles.rowActionBtn, pressed && { opacity: 0.7 }]}
            >
              <Feather name="more-horizontal" size={18} color={Colors.textMuted} />
            </Pressable>
          )}
          <Feather name="chevron-right" size={18} color={Colors.textMuted} />
        </View>
      </Pressable>
    );
  };

  const renderFileItem = ({ item: file }: { item: FileItem }) => (
    <Pressable
      style={({ pressed }) => [styles.fileCard, pressed && { opacity: 0.7 }]}
      onPress={() => { setSelectedFile(file); setShowFileDetail(true); }}
      onLongPress={() => showFileActions(file)}
      accessibilityRole="button"
      accessibilityLabel={t("files.fileAccessibility", { name: file.name, type: file.conversionType || t("files.fileGeneric"), size: formatBytes(file.fileSize) })}
    >
      <View style={styles.fileIconWrap}>
        <Feather name={(FOLDER_ICONS[file.conversionType || ""] || "file-text") as any} size={18} color={Colors.primary} />
      </View>
      <View style={styles.fileInfo}>
        <Text style={[styles.fileName, { fontSize: ts.body }]} numberOfLines={1}>{file.name}</Text>
        <Text style={[styles.fileMeta, { fontSize: ts.sm }]}>
          {file.conversionType && `${file.conversionType} · `}{formatBytes(file.fileSize)} · {formatDate(file.createdAt, language)}
        </Text>
      </View>
      <View style={styles.rowActions}>
        <Pressable
          onPress={(e) => { e.stopPropagation?.(); showFileActions(file); }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={language === "es" ? "Más acciones" : "More actions"}
          style={({ pressed }) => [styles.rowActionBtn, pressed && { opacity: 0.7 }]}
        >
          <Feather name="more-horizontal" size={18} color={Colors.textMuted} />
        </Pressable>
        <Feather name="chevron-right" size={16} color={Colors.textMuted} />
      </View>
    </Pressable>
  );

  const currentFolderName = selectedFolder
    ? folders.find(f => f.id === selectedFolder)?.name || t("files.allFiles")
    : null;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: topPadding + 8 }]}>
        <View style={[styles.headerContent, { maxWidth: layout.contentMaxWidth, alignSelf: "center", width: "100%", paddingHorizontal: layout.contentPadding }]}>
          <Pressable onPress={goBack} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={t("common.back")}>
            <Feather name="arrow-left" size={22} color={Colors.text} />
          </Pressable>
          <View style={styles.headerTitleWrap}>
            <Text style={[styles.headerTitle, { fontSize: ts.heading2 }]}>{currentFolderName || t("files.title")}</Text>
            {storageInfo && storageInfo.limit > 0 && !selectedFolder && (
              <Text style={[styles.headerSubtitle, { fontSize: ts.caption }]}>
                {t("files.storageUsed", { used: formatBytes(storageInfo.used), limit: formatBytes(storageInfo.limit) })}
              </Text>
            )}
          </View>
          <View style={styles.headerActions}>
            <Pressable
              onPress={() => setShowNewFolder(true)}
              style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.7 }]}
              accessibilityLabel={selectedFolder ? t("files.newSubfolder") : t("files.newFolder")}
            >
              <Feather name="folder-plus" size={22} color={Colors.primary} />
            </Pressable>
            {!selectedFolder && (
              <Pressable
                onPress={() => {
                  setViewMode(viewMode === "folders" ? "files" : "folders");
                  if (viewMode === "folders") {
                    setSelectedFolder(null);
                    fetchFiles(null);
                  }
                }}
                style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.7 }]}
                accessibilityLabel={viewMode === "folders" ? t("files.allFiles") : t("files.folders")}
              >
                <Feather name={viewMode === "folders" ? "list" : "grid"} size={22} color={Colors.textSecondary} />
              </Pressable>
            )}
            <Pressable
              style={({ pressed }) => [styles.headerAvatar, pressed && { opacity: 0.7 }]}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push("/settings");
              }}
              accessibilityLabel={t("a11y.settings")}
              accessibilityRole="button"
            >
              {user?.avatarId ? (
                <AvatarView avatarId={user.avatarId} size={72} />
              ) : (
                <Text style={styles.headerAvatarText}>{(user?.firstName || user?.email || "?")[0].toUpperCase()}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>

      {storageInfo && storageInfo.limit > 0 && !selectedFolder && (
        <View style={[styles.storageBar, { maxWidth: layout.contentMaxWidth, alignSelf: "center", width: "100%", paddingHorizontal: layout.contentPadding }]}>
          <View style={styles.storageTrack}>
            <View style={[styles.storageFill, { width: `${Math.min(storageInfo.percentage, 100)}%` },
              storageInfo.percentage > 90 ? { backgroundColor: Colors.error } :
              storageInfo.percentage > 70 ? { backgroundColor: Colors.warning } :
              { backgroundColor: Colors.primary }
            ]} />
          </View>
          <Text style={[styles.storageText, { fontSize: ts.sm }]}>{storageInfo.percentage}% · {storageCountLabel}</Text>
        </View>
      )}

      {(viewMode === "files" || selectedFolder) && (
        <View style={[styles.searchWrap, { maxWidth: layout.contentMaxWidth, alignSelf: "center", width: "100%", paddingHorizontal: layout.contentPadding }]}>
          <Feather name="search" size={16} color={Colors.textMuted} style={styles.searchIcon} />
          <TextInput
            style={[styles.searchInput, { fontSize: ts.body }]}
            placeholder={t("files.searchFiles")}
            placeholderTextColor={Colors.textMuted}
            value={searchQuery}
            onChangeText={setSearchQuery}
            returnKeyType="search"
          />
          {searchQuery.length > 0 && (
            <Pressable onPress={() => setSearchQuery("")} style={styles.searchClear} accessibilityRole="button" accessibilityLabel={t("common.clear")}>
              <Feather name="x" size={16} color={Colors.textMuted} />
            </Pressable>
          )}
        </View>
      )}

      {viewMode === "folders" && !selectedFolder ? (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { maxWidth: layout.contentMaxWidth, alignSelf: "center", width: "100%", paddingHorizontal: layout.contentPadding, paddingBottom: Platform.OS === "web" ? 34 : insets.bottom + 16 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        >
          {systemFolders.length > 0 && (
            <>
              {systemFolders.map(renderFolderItem)}
            </>
          )}
          {customFolders.length > 0 && (
            <>
              <Text style={[styles.sectionLabel, { marginTop: 20 }]}>{t("files.customFolder")} {t("files.folders")}</Text>
              {customFolders.map(renderFolderItem)}
            </>
          )}
          {systemFolders.length === 0 && customFolders.length === 0 && (
            <View style={styles.emptyState}>
              <Feather name="folder" size={48} color={Colors.textMuted} />
              <Text style={[styles.emptyTitle, { fontSize: ts.subtitle }]}>{t("files.empty")}</Text>
              <Text style={[styles.emptyTitle, { fontSize: ts.body2, color: Colors.textMuted, marginTop: 6, fontWeight: "400" }]}>
                Tap the mic on the Record tab to capture your first voice note.
              </Text>
            </View>
          )}
        </ScrollView>
      ) : (
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, { maxWidth: layout.contentMaxWidth, alignSelf: "center", width: "100%", paddingHorizontal: layout.contentPadding, paddingBottom: Platform.OS === "web" ? 34 : insets.bottom + 16 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />}
        >
          {subFolders.length > 0 && (
            <>
              <Text style={styles.sectionLabel}>{t("files.subfolders")}</Text>
              {subFolders.map(renderFolderItem)}
            </>
          )}
          {filteredFiles.length > 0 && (
            <>
              {subFolders.length > 0 && <Text style={[styles.sectionLabel, { marginTop: 16 }]}>{t("files.title")}</Text>}
              {filteredFiles.map(file => (
                <View key={file.id}>{renderFileItem({ item: file })}</View>
              ))}
            </>
          )}
          {subFolders.length === 0 && filteredFiles.length === 0 && (
            <View style={styles.emptyState}>
              <Feather name="folder" size={48} color={Colors.textMuted} />
              <Text style={[styles.emptyTitle, { fontSize: ts.subtitle }]}>{t("files.emptyFolder")}</Text>
            </View>
          )}
        </ScrollView>
      )}

      <Modal visible={showFileDetail} animationType="slide" transparent onRequestClose={() => { setShowFileDetail(false); setSelectedFile(null); }}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { paddingTop: topPadding + 8 }]}>
            <View style={styles.modalHeader}>
              <Pressable onPress={() => { setShowFileDetail(false); setSelectedFile(null); }} style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={t("common.close")}>
                <Feather name="x" size={22} color={Colors.text} />
              </Pressable>
              <Text style={[styles.modalTitle, { fontSize: ts.subtitle2 }]} numberOfLines={1}>{selectedFile?.name}</Text>
              <View style={styles.modalActions}>
                {selectedFile && (
                  <>
                    <Pressable onPress={() => handleCopyContent(selectedFile)} style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={t("common.copy")}>
                      <Feather name="copy" size={20} color={Colors.textSecondary} />
                    </Pressable>
                    <Pressable onPress={() => handleShareFile(selectedFile)} style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={t("common.share")}>
                      <Feather name="share-2" size={20} color={Colors.textSecondary} />
                    </Pressable>
                    <Pressable onPress={() => handleDownloadFile(selectedFile)} style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={t("common.download")}>
                      <Feather name="download" size={20} color={Colors.textSecondary} />
                    </Pressable>
                    <Pressable onPress={() => handleDeleteFile(selectedFile)} style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.7 }]} accessibilityRole="button" accessibilityLabel={t("common.delete")}>
                      <Feather name="trash-2" size={20} color={Colors.error} />
                    </Pressable>
                  </>
                )}
              </View>
            </View>
            {selectedFile && (
              <View style={styles.fileDetailMeta}>
                {selectedFile.conversionType && (
                  <View style={styles.metaBadge}>
                    <Feather name={(FOLDER_ICONS[selectedFile.conversionType] || "file-text") as any} size={12} color={Colors.primary} />
                    <Text style={styles.metaBadgeText}>{selectedFile.conversionType}</Text>
                  </View>
                )}
                <Text style={styles.fileDetailMetaText}>{formatBytes(selectedFile.fileSize)} · {formatDate(selectedFile.createdAt, language)}</Text>
              </View>
            )}
            <ScrollView style={styles.fileContentScroll} contentContainerStyle={{ paddingBottom: 40 }}>
              <Text style={styles.fileContentText} selectable>{selectedFile?.content}</Text>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={showNewFolder} animationType="fade" transparent onRequestClose={() => setShowNewFolder(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowNewFolder(false)}>
          <Pressable style={styles.dialogBox} onPress={e => e.stopPropagation()}>
            <Text style={styles.dialogTitle}>{t("files.newFolder")}</Text>
            <TextInput
              style={styles.dialogInput}
              placeholder={t("files.folderNamePlaceholder")}
              placeholderTextColor={Colors.textMuted}
              value={newFolderName}
              onChangeText={setNewFolderName}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleCreateFolder}
            />
            <View style={styles.dialogButtons}>
              <Pressable onPress={() => setShowNewFolder(false)} style={({ pressed }) => [styles.dialogBtn, pressed && { opacity: 0.7 }]}>
                <Text style={styles.dialogBtnText}>{t("common.cancel")}</Text>
              </Pressable>
              <Pressable onPress={handleCreateFolder} style={({ pressed }) => [styles.dialogBtn, styles.dialogBtnPrimary, pressed && { opacity: 0.7 }]} disabled={actionLoading}>
                {actionLoading ? <ActivityIndicator size="small" color={Colors.white} /> : <Text style={styles.dialogBtnPrimaryText}>{t("common.save")}</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={showRenameModal} animationType="fade" transparent onRequestClose={() => setShowRenameModal(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowRenameModal(false)}>
          <Pressable style={styles.dialogBox} onPress={e => e.stopPropagation()}>
            <Text style={styles.dialogTitle}>{t("files.rename")}</Text>
            <TextInput
              style={styles.dialogInput}
              placeholder={renameTarget?.name || ""}
              placeholderTextColor={Colors.textMuted}
              value={renameName}
              onChangeText={setRenameName}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={handleRename}
            />
            <View style={styles.dialogButtons}>
              <Pressable onPress={() => setShowRenameModal(false)} style={({ pressed }) => [styles.dialogBtn, pressed && { opacity: 0.7 }]}>
                <Text style={styles.dialogBtnText}>{t("common.cancel")}</Text>
              </Pressable>
              <Pressable onPress={handleRename} style={({ pressed }) => [styles.dialogBtn, styles.dialogBtnPrimary, pressed && { opacity: 0.7 }]} disabled={actionLoading}>
                {actionLoading ? <ActivityIndicator size="small" color={Colors.white} /> : <Text style={styles.dialogBtnPrimaryText}>{t("common.save")}</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={!!actionMenuTarget} animationType="fade" transparent onRequestClose={() => setActionMenuTarget(null)}>
        <Pressable style={styles.modalOverlay} onPress={() => setActionMenuTarget(null)}>
          <Pressable style={styles.dialogBox} onPress={e => e.stopPropagation()}>
            <Text style={styles.dialogTitle}>
              {actionMenuTarget?.type === "folder" ? actionMenuTarget.folder.name : actionMenuTarget?.file.name}
            </Text>
            <View style={styles.actionMenuList}>
              <Pressable
                onPress={() => {
                  if (!actionMenuTarget) return;
                  if (actionMenuTarget.type === "folder") {
                    setRenameTarget({ id: actionMenuTarget.folder.id, name: actionMenuTarget.folder.name, type: "folder" });
                    setRenameName(actionMenuTarget.folder.name);
                  } else {
                    setRenameTarget({ id: actionMenuTarget.file.id, name: actionMenuTarget.file.name, type: "file" });
                    setRenameName(actionMenuTarget.file.name);
                  }
                  setActionMenuTarget(null);
                  setShowRenameModal(true);
                }}
                style={({ pressed }) => [styles.actionMenuItem, pressed && { opacity: 0.7 }]}
              >
                <Feather name="edit-2" size={16} color={Colors.text} />
                <Text style={styles.actionMenuText}>{t("files.rename")}</Text>
              </Pressable>

              {actionMenuTarget?.type === "file" && (
                <>
                  <Pressable
                    onPress={() => {
                      setMoveFileId(actionMenuTarget.file.id);
                      setActionMenuTarget(null);
                      setShowMoveModal(true);
                    }}
                    style={({ pressed }) => [styles.actionMenuItem, pressed && { opacity: 0.7 }]}
                  >
                    <Feather name="corner-up-right" size={16} color={Colors.text} />
                    <Text style={styles.actionMenuText}>{t("files.move")}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      const targetFile = actionMenuTarget.file;
                      setActionMenuTarget(null);
                      handleShareFile(targetFile);
                    }}
                    style={({ pressed }) => [styles.actionMenuItem, pressed && { opacity: 0.7 }]}
                  >
                    <Feather name="share-2" size={16} color={Colors.text} />
                    <Text style={styles.actionMenuText}>{t("common.share")}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      const targetFile = actionMenuTarget.file;
                      setActionMenuTarget(null);
                      handleDownloadFile(targetFile);
                    }}
                    style={({ pressed }) => [styles.actionMenuItem, pressed && { opacity: 0.7 }]}
                  >
                    <Feather name="download" size={16} color={Colors.text} />
                    <Text style={styles.actionMenuText}>{t("common.download")}</Text>
                  </Pressable>
                </>
              )}

              <Pressable
                onPress={() => {
                  const target = actionMenuTarget;
                  setActionMenuTarget(null);
                  if (!target) return;
                  if (target.type === "folder") {
                    handleDeleteFolder(target.folder);
                  } else {
                    handleDeleteFile(target.file);
                  }
                }}
                style={({ pressed }) => [styles.actionMenuItem, pressed && { opacity: 0.7 }]}
              >
                <Feather name="trash-2" size={16} color={Colors.error} />
                <Text style={[styles.actionMenuText, { color: Colors.error }]}>{t("common.delete")}</Text>
              </Pressable>
            </View>
            <View style={styles.dialogButtons}>
              <Pressable onPress={() => setActionMenuTarget(null)} style={({ pressed }) => [styles.dialogBtn, pressed && { opacity: 0.7 }]}>
                <Text style={styles.dialogBtnText}>{t("common.cancel")}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={showMoveModal} animationType="slide" transparent onRequestClose={() => setShowMoveModal(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowMoveModal(false)}>
          <Pressable style={styles.moveSheet} onPress={e => e.stopPropagation()}>
            <Text style={styles.dialogTitle}>{t("files.moveFile")}</Text>
            <ScrollView style={{ maxHeight: 400 }}>
              <Pressable
                style={({ pressed }) => [styles.moveFolderItem, pressed && { opacity: 0.7 }]}
                onPress={() => handleMoveFile(null)}
              >
                <Feather name="inbox" size={18} color={Colors.textMuted} />
                <Text style={styles.moveFolderName}>{t("files.unfiled")}</Text>
              </Pressable>
              {folders.map(folder => (
                <Pressable
                  key={folder.id}
                  style={({ pressed }) => [styles.moveFolderItem, pressed && { opacity: 0.7 }]}
                  onPress={() => handleMoveFile(folder.id)}
                >
                  <Feather name={(FOLDER_ICONS[folder.name] || "folder") as any} size={18} color={folder.isSystem ? Colors.primary : Colors.warning} />
                  <Text style={styles.moveFolderName}>{folder.name}</Text>
                  <Text style={styles.moveFolderCount}>{folder.fileCount}</Text>
                </Pressable>
              ))}
            </ScrollView>
            {actionLoading && <ActivityIndicator size="small" color={Colors.primary} style={{ marginTop: 12 }} />}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const makeStyles = (ts: TextScale) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    backgroundColor: Colors.background,
    borderBottomWidth: 0,
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    gap: 12,
  },
  backBtn: {
    padding: 4,
  },
  headerTitleWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: sf(20, ts),
    fontWeight: "700",
    color: Colors.text,
  },
  headerSubtitle: {
    fontSize: sf(12, ts),
    color: Colors.textSecondary,
    marginTop: 2,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 20,
  },
  actionBtn: {
    padding: 6,
  },
  headerAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(0, 180, 216, 0.15)",
    justifyContent: "center" as const,
    alignItems: "center" as const,
    overflow: "hidden" as const,
  },
  headerAvatarText: {
    fontFamily: "Inter_700Bold",
    fontSize: sf(26, ts),
    color: Colors.primary,
  },
  storageBar: {
    paddingVertical: 10,
  },
  storageTrack: {
    height: 4,
    backgroundColor: Colors.surfaceLight,
    borderRadius: 2,
    overflow: "hidden",
  },
  storageFill: {
    height: "100%",
    borderRadius: 2,
  },
  storageText: {
    fontSize: sf(11, ts),
    color: Colors.textMuted,
    marginTop: 4,
  },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 10,
    marginVertical: 8,
    paddingHorizontal: 12,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    height: 40,
    color: Colors.text,
    fontSize: sf(14, ts),
    outlineStyle: "none" as any,
    outlineWidth: 0 as any,
  },
  searchClear: {
    padding: 4,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 12,
  },
  sectionLabel: {
    fontSize: sf(12, ts),
    fontWeight: "600",
    color: Colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 8,
    marginTop: 4,
  },
  folderCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 14,
  },
  folderMainBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  folderIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  systemFolderIcon: {
    backgroundColor: "rgba(0, 180, 216, 0.08)",
  },
  customFolderIcon: {
    backgroundColor: "rgba(251, 191, 36, 0.08)",
  },
  folderInfo: {
    flex: 1,
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  rowActionBtn: {
    width: 44,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  folderName: {
    fontSize: sf(15, ts),
    fontWeight: "600",
    color: Colors.text,
  },
  folderMeta: {
    fontSize: sf(12, ts),
    color: Colors.textMuted,
    marginTop: 2,
  },
  fileCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
  },
  fileMainBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  fileIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 9,
    backgroundColor: "rgba(0, 180, 216, 0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  fileInfo: {
    flex: 1,
  },
  fileName: {
    fontSize: sf(14, ts),
    fontWeight: "600",
    color: Colors.text,
  },
  fileMeta: {
    fontSize: sf(11, ts),
    color: Colors.textMuted,
    marginTop: 2,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 60,
    gap: 12,
  },
  emptyTitle: {
    fontSize: sf(16, ts),
    fontWeight: "600",
    color: Colors.textSecondary,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: "center",
    alignItems: "center",
  },
  modalContent: {
    flex: 1,
    backgroundColor: Colors.background,
    width: "100%",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
  },
  modalTitle: {
    flex: 1,
    fontSize: sf(17, ts),
    fontWeight: "600",
    color: Colors.text,
  },
  modalActions: {
    flexDirection: "row",
    gap: 4,
  },
  fileDetailMeta: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  metaBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0, 180, 216, 0.12)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  metaBadgeText: {
    fontSize: sf(11, ts),
    fontWeight: "600",
    color: Colors.primary,
  },
  fileDetailMetaText: {
    fontSize: sf(12, ts),
    color: Colors.textMuted,
  },
  fileContentScroll: {
    flex: 1,
    padding: 16,
  },
  fileContentText: {
    fontSize: sf(14, ts),
    lineHeight: 22,
    color: Colors.text,
    fontFamily: Platform.OS === "web" ? "monospace" : undefined,
  },
  dialogBox: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 20,
    width: "90%",
    maxWidth: 400,
    borderWidth: 0,
  },
  dialogTitle: {
    fontSize: sf(17, ts),
    fontWeight: "700",
    color: Colors.text,
    marginBottom: 16,
  },
  dialogInput: {
    backgroundColor: Colors.surfaceLight,
    borderRadius: 10,
    padding: 12,
    color: Colors.text,
    fontSize: sf(15, ts),
    marginBottom: 16,
    outlineStyle: "none" as any,
    outlineWidth: 0 as any,
  },
  dialogButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  actionMenuList: {
    gap: 8,
    marginTop: 4,
    marginBottom: 16,
  },
  actionMenuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    backgroundColor: Colors.surfaceLight,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  actionMenuText: {
    fontSize: sf(14, ts),
    fontWeight: "600",
    color: Colors.text,
  },
  dialogBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
  },
  dialogBtnText: {
    fontSize: sf(14, ts),
    fontWeight: "600",
    color: Colors.textSecondary,
  },
  dialogBtnPrimary: {
    backgroundColor: Colors.primaryButton,
  },
  dialogBtnPrimaryText: {
    fontSize: sf(14, ts),
    fontWeight: "600",
    color: Colors.white,
  },
  moveSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    width: "100%",
    maxHeight: "70%",
    position: "absolute",
    bottom: 0,
    borderWidth: 0,
  },
  moveFolderItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 8,
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  moveFolderName: {
    flex: 1,
    fontSize: sf(15, ts),
    color: Colors.text,
  },
  moveFolderCount: {
    fontSize: sf(12, ts),
    color: Colors.textMuted,
  },
});
