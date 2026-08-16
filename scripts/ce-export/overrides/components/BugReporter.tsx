import React, { useEffect, useState } from "react";
import { View, Text, TextInput, StyleSheet, Modal, TouchableOpacity, ActivityIndicator, Platform } from "react-native";
import { useAuth } from "@/lib/auth-context";
import Feather from "@react-native-vector-icons/feather/static";
import Colors from "@/constants/colors";
// @ts-ignore
import html2canvas from "html2canvas";

export default function BugReporter() {
  const { user } = useAuth();
  const [isVisible, setIsVisible] = useState(false);
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  // Only render for admins
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    if (!isAdmin || Platform.OS !== "web") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Listen for Ctrl+Shift+B or Cmd+Shift+B
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setIsVisible(true);
        setError("");
        setSuccess(false);
        setDescription("");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isAdmin]);

  const handleSubmit = async () => {
    if (!description.trim()) {
      setError("Please provide a description of the bug.");
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      let imageBase64 = "";
      if (Platform.OS === "web") {
        // Hide the modal temporarily while capturing
        const modalEl = document.getElementById("bug-reporter-modal");
        if (modalEl) modalEl.style.display = "none";
        
        // Give the DOM a tiny bit of time to hide the modal
        await new Promise((resolve) => setTimeout(resolve, 50));
        
        const canvas = await html2canvas(document.body, {
          useCORS: true,
          logging: false,
          ignoreElements: (element) => element.id === "bug-reporter-modal",
        });
        imageBase64 = canvas.toDataURL("image/png");
        
        if (modalEl) modalEl.style.display = "flex";
      }

      const payload = {
        description,
        image: imageBase64,
        url: Platform.OS === "web" ? window.location.href : "mobile-app",
        userAgent: Platform.OS === "web" ? navigator.userAgent : "mobile",
        windowSize: Platform.OS === "web" ? `${window.innerWidth}x${window.innerHeight}` : "unknown",
        timestamp: new Date().toISOString(),
      };

      const res = await fetch("/api/bugs/report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to submit bug report.");
      }

      setSuccess(true);
      setTimeout(() => {
        setIsVisible(false);
        setSuccess(false);
        setDescription("");
      }, 2000);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An unexpected error occurred.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isVisible || !isAdmin) return null;

  return (
    <Modal transparent animationType="fade" visible={isVisible}>
      <View style={styles.overlay} id="bug-reporter-modal">
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={styles.title}>
              <Feather name="alert-triangle" size={18} color={Colors.error} /> Report UI Bug
            </Text>
            <TouchableOpacity onPress={() => setIsVisible(false)}>
              <Feather name="x" size={24} color={Colors.text} />
            </TouchableOpacity>
          </View>

          {success ? (
            <View style={styles.successContainer}>
              <Feather name="check-circle" size={48} color={Colors.success} />
              <Text style={styles.successText}>Bug report sent to repository!</Text>
            </View>
          ) : (
            <>
              <Text style={styles.subtitle}>
                A screenshot of the current screen will be automatically captured and attached.
              </Text>

              <TextInput
                style={styles.input}
                placeholder="Describe the issue... (What is broken? What did you expect?)"
                placeholderTextColor={Colors.textMuted}
                multiline
                numberOfLines={6}
                value={description}
                onChangeText={setDescription}
                editable={!isSubmitting}
                autoFocus
              />

              {error ? <Text style={styles.errorText}>{error}</Text> : null}

              <View style={styles.footer}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={() => setIsVisible(false)}
                  disabled={isSubmitting}
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.submitButton, isSubmitting && styles.submitButtonDisabled]}
                  onPress={handleSubmit}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.submitButtonText}>Submit Bug Report</Text>
                  )}
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 99999,
  },
  container: {
    width: "90%",
    maxWidth: 500,
    backgroundColor: Colors.background,
    borderRadius: 12,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 5,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
    color: Colors.text,
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  subtitle: {
    fontSize: 14,
    color: Colors.textMuted,
    marginBottom: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: Colors.text,
    backgroundColor: Colors.surface,
    minHeight: 120,
    textAlignVertical: "top",
    marginBottom: 16,
  },
  errorText: {
    color: Colors.error,
    marginBottom: 16,
    fontSize: 14,
  },
  successContainer: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
    gap: 16,
  },
  successText: {
    fontSize: 18,
    fontWeight: "500",
    color: Colors.success,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
  },
  cancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  cancelButtonText: {
    fontSize: 16,
    color: Colors.text,
  },
  submitButton: {
    backgroundColor: Colors.primary,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    justifyContent: "center",
    alignItems: "center",
    minWidth: 140,
  },
  submitButtonDisabled: {
    opacity: 0.7,
  },
  submitButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
  },
});