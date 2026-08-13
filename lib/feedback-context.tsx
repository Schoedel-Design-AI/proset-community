import React, { createContext, useContext, useState } from "react";

type FeedbackContextType = {
  feedbackVisible: boolean;
  openFeedback: () => void;
  closeFeedback: () => void;
};

const FeedbackContext = createContext<FeedbackContextType | null>(null);

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [feedbackVisible, setFeedbackVisible] = useState(false);
  return (
    <FeedbackContext.Provider
      value={{
        feedbackVisible,
        openFeedback: () => setFeedbackVisible(true),
        closeFeedback: () => setFeedbackVisible(false),
      }}
    >
      {children}
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const ctx = useContext(FeedbackContext);
  if (!ctx) {
    throw new Error("useFeedback must be used within a FeedbackProvider");
  }
  return ctx;
}
