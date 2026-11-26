import { useState } from "react";
import {
  LAYOUT_SESSION_TYPES,
  LAYOUT_SIMS,
  MAX_CAR_NAME,
  MAX_LAYOUT_NAME,
  SESSION_TYPE_LABELS,
  SIM_LABELS,
  type LayoutMatch,
  type LayoutView,
  type LayoutsState,
} from "../../../shared/layout-types";
import { Button, Row, Section, Toggle } from "../controls";
import {
  addCar,
  contextLabels,
  hasCar,
  overlayCountLabel,
  tagsSummary,
  toggleSession,
  toggleSim,
} from "./model";
import "./layouts.css";

export interface LayoutActions {
  activate(id: string): void;
  create(): void;
  duplicate(id: string): void;
  rename(id: string, name: string): void;
  remove(id: string): void;
  setMatch(id: string, patch: Partial<LayoutMatch>): void;
  setAutoSwitch(on: boolean): void;
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange(): void;
}) {
  return (
    <label className="lay-check">
      <input type="checkbox" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

function TagEditor({
  layout,
  currentCar,
  actions,
}: {
  layout: LayoutView;
  currentCar: string | null;
  actions: LayoutActions;
}) {
  const [draft, setDraft] = useState("");
  const { match, id } = layout;
  const setCars = (cars: string[]): void => actions.setMatch(id, { cars });
  const addDraft = (): void => {
    if (draft.trim() === "") return;
    setCars(addCar(match.cars, draft));
    setDraft("");
  };
  const canAddCurrent = currentCar !== null && !hasCar(match.cars, currentCar);
  return (
    <div className="lay-tags">
      <Row label="Sims" help="None ticked: any sim.">
        <div className="lay-checks" role="group" aria-label="Sims">
          {LAYOUT_SIMS.map((sim) => (
            <Check
              key={sim}
              label={SIM_LABELS[sim]}
              checked={match.sims.includes(sim)}
              onChange={() => actions.setMatch(id, { sims: toggleSim(match, sim) })}
            />
          ))}
        </div>
      </Row>
      <Row label="Sessions" help="None ticked: all sessions.">
        <div className="lay-checks" role="group" aria-label="Sessions">
          {LAYOUT_SESSION_TYPES.map((session) => (
            <Check
              key={session}
              label={SESSION_TYPE_LABELS[session]}
              checked={match.sessions.includes(session)}
              onChange={() => actions.setMatch(id, { sessions: toggleSession(match, session) })}
            />
          ))}
        </div>
      </Row>
      <Row label="Cars" help="Car names as the sim reports them. None listed: any car.">
        <div className="lay-cars">
          {match.cars.length > 0 && (
            <ul className="lay-car-list" aria-label="Cars">
              {match.cars.map((car) => (
                <li key={car}>
                  <span>{car}</span>
                  <button
                    type="button"
                    className="lay-car-remove"
                    aria-label={`Remove ${car}`}
                    onClick={() => setCars(match.cars.filter((c) => c !== car))}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="lay-car-add">
            <input
              type="text"
              className="lay-input"
              aria-label="Car name"
              placeholder="Car name"
              maxLength={MAX_CAR_NAME}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addDraft();
              }}
            />
            <Button disabled={draft.trim() === ""} onClick={addDraft}>
              Add
            </Button>
            <Button
              disabled={!canAddCurrent}
              onClick={() => {
                if (currentCar !== null) setCars(addCar(match.cars, currentCar));
              }}
            >
              Add current car
            </Button>
          </div>
        </div>
      </Row>
    </div>
  );
}

function LayoutItem({
  layout,
  active,
  currentCar,
  actions,
  initiallyEditing,
}: {
  layout: LayoutView;
  active: boolean;
  currentCar: string | null;
  actions: LayoutActions;
  initiallyEditing: boolean;
}) {
  const [editing, setEditing] = useState(initiallyEditing);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(layout.name);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const commitName = (): void => {
    setRenaming(false);
    if (nameDraft.trim() !== "" && nameDraft.trim() !== layout.name) {
      actions.rename(layout.id, nameDraft);
    }
  };
  return (
    <li className="lay-item" data-active={active || undefined}>
      <div className="lay-head">
        {renaming ? (
          <input
            type="text"
            className="lay-input lay-name-input"
            aria-label="Layout name"
            maxLength={MAX_LAYOUT_NAME}
            value={nameDraft}
            autoFocus
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitName}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitName();
              else if (e.key === "Escape") {
                setNameDraft(layout.name);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <span className="lay-name">{layout.name}</span>
        )}
        {active && <span className="lay-active">Active</span>}
        <span className="lay-count muted">{overlayCountLabel(layout.overlayCount)}</span>
      </div>
      <p className="muted lay-summary">{tagsSummary(layout)}</p>
      <div className="lay-actions">
        <Button
          variant={active ? "secondary" : "primary"}
          disabled={active}
          onClick={() => actions.activate(layout.id)}
        >
          Activate
        </Button>
        {!layout.isDefault && (
          <Button
            onClick={() => {
              setNameDraft(layout.name);
              setRenaming(true);
            }}
          >
            Rename
          </Button>
        )}
        <Button onClick={() => actions.duplicate(layout.id)}>Duplicate</Button>
        {!layout.isDefault && (
          <Button onClick={() => setEditing(!editing)}>{editing ? "Done" : "Edit tags"}</Button>
        )}
        {!layout.isDefault && !confirmingDelete && (
          <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
            Delete
          </Button>
        )}
      </div>
      {confirmingDelete && (
        <div className="lay-confirm">
          <span>{`Delete ${layout.name}? Its positions and on/off choices are lost.`}</span>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmingDelete(false);
              actions.remove(layout.id);
            }}
          >
            Delete
          </Button>
          <Button onClick={() => setConfirmingDelete(false)}>Cancel</Button>
        </div>
      )}
      {editing && !layout.isDefault && (
        <TagEditor layout={layout} currentCar={currentCar} actions={actions} />
      )}
    </li>
  );
}

/** The Layouts page itself, separate from the IPC hooks so it renders with a fake state. */
export function LayoutsView({
  state,
  actions,
  editingId,
}: {
  state: LayoutsState;
  actions: LayoutActions;
  /** A layout whose tag editor starts open (tests). */
  editingId?: string;
}) {
  const now = contextLabels(state.context);
  return (
    <>
      <Section
        title="Current session"
        description="What the automatic switch looks at. It picks the layout whose tags fit best: a car tag counts most, then the session, then the sim."
      >
        <Row label="Sim">
          <span className="lay-value">{now.sim}</span>
        </Row>
        <Row label="Car">
          <span className="lay-value">{now.car}</span>
        </Row>
        <Row label="Session">
          <span className="lay-value">{now.session}</span>
        </Row>
        <Row
          label="Switch layouts automatically"
          help="When the sim, your car or the session type changes. A layout you pick here stays until the next change."
        >
          <Toggle
            label="Switch layouts automatically"
            checked={state.autoSwitch}
            onChange={(on) => actions.setAutoSwitch(on)}
          />
        </Row>
      </Section>
      <Section
        title="Layouts"
        description="Each layout keeps its own overlay positions, sizes and which overlays are on. Overlay settings are shared by every layout."
      >
        <ul className="lay-list">
          {state.layouts.map((layout) => (
            <LayoutItem
              key={layout.id}
              layout={layout}
              active={layout.id === state.activeId}
              currentCar={state.context.carName}
              actions={actions}
              initiallyEditing={layout.id === editingId}
            />
          ))}
        </ul>
        <div className="lay-footer">
          <Button variant="primary" onClick={actions.create}>
            New layout
          </Button>
          <small className="muted">Starts as a copy of the active layout.</small>
        </div>
      </Section>
    </>
  );
}
