package ms.aifor.app.upload;

import com.google.firebase.auth.FirebaseAuth;
import com.google.firebase.auth.FirebaseUser;
import java.util.concurrent.CompletableFuture;

/**
 * Narrow Java boundary for Firebase Auth token access.
 *
 * Firebase Auth 24.1.0 publishes Kotlin 2.3 metadata while React Native 0.86.2
 * currently compiles this app with Kotlin 2.1.20. Keeping Firebase types in a
 * separate Java-only Android library lets UploadWorker consume a standard JDK
 * future without downgrading Firebase, changing the React Native toolchain,
 * suppressing metadata validation, or using reflection.
 */
public final class FirebaseTokenProvider {
    private FirebaseTokenProvider() {}

    public static CompletableFuture<String> getToken(
        boolean forceRefresh,
        String fallbackToken
    ) {
        CompletableFuture<String> future = new CompletableFuture<>();
        String fallback = normalize(fallbackToken);

        final FirebaseUser user;
        try {
            user = FirebaseAuth.getInstance().getCurrentUser();
        } catch (IllegalStateException error) {
            completeWithFallbackOrError(future, fallback, error);
            return future;
        }

        if (user == null) {
            future.complete(fallback);
            return future;
        }

        user.getIdToken(forceRefresh).addOnCompleteListener(task -> {
            if (task.isSuccessful() && task.getResult() != null) {
                future.complete(normalize(task.getResult().getToken()));
                return;
            }

            Exception error = task.getException();
            if (!forceRefresh && fallback != null) {
                future.complete(fallback);
            } else if (error != null) {
                future.completeExceptionally(error);
            } else {
                future.complete(null);
            }
        });
        return future;
    }

    private static String normalize(String token) {
        if (token == null) return null;
        String trimmed = token.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private static void completeWithFallbackOrError(
        CompletableFuture<String> future,
        String fallback,
        Exception error
    ) {
        if (fallback != null) {
            future.complete(fallback);
        } else {
            future.completeExceptionally(error);
        }
    }
}
