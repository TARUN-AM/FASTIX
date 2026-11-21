import React from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import Button from "./Button";

/**
 * React ErrorBoundary catching unexpected render errors and offering a safe page reload.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    if (import.meta.env.DEV) {
      console.error("[FairTicket ErrorBoundary]", error, info);
    }
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-[60vh] items-center justify-center px-4 py-12">
          <div
            role="alert"
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm"
          >
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-red-50 text-danger">
              <AlertTriangle className="h-6 w-6" aria-hidden="true" />
            </div>
            <h1 className="text-lg font-semibold text-navy">
              Something went wrong
            </h1>
            <p className="mt-2 text-sm text-slate-600">
              An unexpected error prevented this view from loading cleanly.
              Please reload the page to try again.
            </p>
            <div className="mt-6">
              <Button
                variant="primary"
                onClick={this.handleReload}
                leftIcon={<RotateCw className="h-4 w-4" />}
              >
                Reload page
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
