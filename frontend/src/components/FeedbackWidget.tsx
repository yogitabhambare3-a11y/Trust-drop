import { useState } from "react";
import { submitFeedback } from "../lib/api";
import { useToast } from "./Toast";

interface FeedbackWidgetProps {
  dropId: string;
  wallet: string;
}

export function FeedbackWidget({ dropId, wallet }: FeedbackWidgetProps) {
  const { toast } = useToast();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className="card mt-6 text-center text-sm text-emerald-300">
        Thanks for your feedback!
      </div>
    );
  }

  return (
    <div className="card mt-6">
      <h3 className="font-semibold text-white">How was your claim experience?</h3>
      <div className="mt-3 flex gap-2">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={`h-10 w-10 rounded-full border text-sm font-bold ${
              rating >= n
                ? "border-amber-400 bg-amber-400/20 text-amber-300"
                : "border-slate-700 text-slate-400"
            }`}
            onClick={() => setRating(n)}
          >
            {n}
          </button>
        ))}
      </div>
      <textarea
        className="input mt-3 min-h-[80px]"
        placeholder="Optional comment…"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
      />
      <button
        type="button"
        className="btn-primary mt-3"
        disabled={rating === 0 || submitting}
        onClick={async () => {
          setSubmitting(true);
          try {
            await submitFeedback({ dropId, wallet, rating, comment: comment || undefined });
            setDone(true);
            toast("Feedback submitted", "success");
          } catch (e) {
            toast(e instanceof Error ? e.message : "Failed to submit feedback", "error");
          } finally {
            setSubmitting(false);
          }
        }}
      >
        {submitting ? "Submitting…" : "Submit feedback"}
      </button>
    </div>
  );
}
