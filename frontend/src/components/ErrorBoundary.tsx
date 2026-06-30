import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message?: string;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="mx-auto max-w-lg p-8 text-center">
          <h1 className="text-xl font-bold text-red-400">Something went wrong</h1>
          <p className="mt-2 text-slate-400">{this.state.message}</p>
          <button
            type="button"
            className="btn-primary mt-6"
            onClick={() => this.setState({ hasError: false })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
