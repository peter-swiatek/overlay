import { useEffect, useState } from "react";
import { EditFrame } from "./EditFrame";
import { DemoInputs } from "./DemoInputs";
import { DemoRelative } from "./DemoRelative";

export function App() {
  const id = new URLSearchParams(window.location.search).get("id");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    void window.overlayApi.getEditMode().then(setEditing);
    return window.overlayApi.onEditModeChanged(setEditing);
  }, []);

  const name = id === "inputs" ? "Demo Inputs" : "Demo Relative";

  return (
    <div className="overlay">
      {id === "inputs" ? <DemoInputs /> : <DemoRelative />}
      {editing && <EditFrame name={name} />}
    </div>
  );
}
