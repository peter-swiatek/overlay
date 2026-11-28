import { Component, type ReactNode } from "react";

interface Props {
  /** The boundary recovers when this changes (the overlay's settings). */
  resetKey: unknown;
  /** Names the overlay in the log. */
  name: string;
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/** A crashing overlay shows a one-line panel instead of a blank window. */
export class OverlayErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    console.error(`Overlay "${this.props.name}" crashed`, error);
  }

  override componentDidUpdate(prev: Props): void {
    if (this.state.failed && prev.resetKey !== this.props.resetKey)
      this.setState({ failed: false });
  }

  override render(): ReactNode {
    if (this.state.failed) return <div className="panel notice">Overlay error</div>;
    return this.props.children;
  }
}
