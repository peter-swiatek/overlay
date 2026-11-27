import { useState } from "react";
import type { SimName } from "@overlay/sim-core/types";
import {
  CAR_TYPES,
  CAR_TYPE_LABELS,
  LAYOUT_SESSION_TYPES,
  MAX_CAR_NAME,
  MAX_LAYOUT_NAME,
  SESSION_TYPE_LABELS,
  SIM_LABELS,
  type LayoutMatch,
  type LayoutView,
  type LayoutsState,
} from "../../../shared/layout-types";
import { Button, Row, Section, Segmented, Toggle } from "../controls";
import {
  addCar,
  contextLabels,
  countOn,
  hasCar,
  overlaysForGame,
  toggleIn,
  type GroupOverlay,
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
  setEnabled(id: string, instanceId: string, on: boolean): void;
}

type GameChoice = "any" | SimName;

const GAME_OPTIONS: { value: GameChoice; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "iracing", label: SIM_LABELS.iracing },
  { value: "lmu", label: SIM_LABELS.lmu },
];

function Chips<T extends string>({
  label,
  values,
  selected,
  labels,
  onToggle,
}: {
  label: string;
  values: readonly T[];
  selected: readonly T[];
  labels: Readonly<Record<T, string>>;
  onToggle(value: T): void;
}) {
  return (
    <div className="grp-chips" role="group" aria-label={label}>
      {values.map((v) => (
        <button
          key={v}
          type="button"
          className="grp-chip"
          aria-pressed={selected.includes(v)}
          onClick={() => onToggle(v)}
        >
          {labels[v]}
        </button>
      ))}
    </div>
  );
}

function SpecificCars({
  group,
  currentCar,
  actions,
}: {
  group: LayoutView;
  currentCar: string | null;
  actions: LayoutActions;
}) {
  const [draft, setDraft] = useState("");
  const cars = group.match.cars;
  const setCars = (next: string[]): void => actions.setMatch(group.id, { cars: next });
  const addDraft = (): void => {
    if (draft.trim() === "") return;
    setCars(addCar(cars, draft));
    setDraft("");
  };
  const canAddCurrent = currentCar !== null && !hasCar(cars, currentCar);
  return (
    <details className="grp-cars">
      <summary>
        Specific cars{cars.length > 0 ? ` (${cars.length})` : ""}
        <small className="muted"> Optional. A listed car counts more than anything else.</small>
      </summary>
      {cars.length > 0 && (
        <ul className="grp-car-list" aria-label="Specific cars">
          {cars.map((car) => (
            <li key={car}>
              <span>{car}</span>
              <button
                type="button"
                className="grp-car-remove"
                aria-label={`Remove ${car}`}
                onClick={() => setCars(cars.filter((c) => c !== car))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="grp-car-add">
        <input
          type="text"
          className="grp-input"
          aria-label="Car name"
          placeholder="Car name as the sim shows it"
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
            if (currentCar !== null) setCars(addCar(cars, currentCar));
          }}
        >
          Add current car
        </Button>
      </div>
    </details>
  );
}

function ActiveWhen({
  group,
  currentCar,
  actions,
}: {
  group: LayoutView;
  currentCar: string | null;
  actions: LayoutActions;
}) {
  const { match, id } = group;
  const set = (patch: Partial<LayoutMatch>): void => actions.setMatch(id, patch);
  return (
    <div className="grp-block">
      <h3 className="grp-block-title">Active when</h3>
      <Row label="Game">
        <Segmented
          label="Game"
          value={match.game ?? "any"}
          options={GAME_OPTIONS}
          onChange={(game) => set({ game: game === "any" ? null : game })}
        />
      </Row>
      <Row label="Sessions" help="None on: all sessions.">
        <Chips
          label="Sessions"
          values={LAYOUT_SESSION_TYPES}
          selected={match.sessions}
          labels={SESSION_TYPE_LABELS}
          onToggle={(s) => set({ sessions: toggleIn(match.sessions, s, LAYOUT_SESSION_TYPES) })}
        />
      </Row>
      {match.game !== "lmu" && (
        <Row label="Car type" help="iRacing only. None on: any car.">
          <Chips
            label="Car type"
            values={CAR_TYPES}
            selected={match.carTypes}
            labels={CAR_TYPE_LABELS}
            onToggle={(t) => set({ carTypes: toggleIn(match.carTypes, t, CAR_TYPES) })}
          />
        </Row>
      )}
      <SpecificCars group={group} currentCar={currentCar} actions={actions} />
    </div>
  );
}

function GroupOverlays({
  group,
  overlays,
  actions,
}: {
  group: LayoutView;
  overlays: readonly GroupOverlay[];
  actions: LayoutActions;
}) {
  const offered = overlaysForGame(overlays, group.match.game);
  return (
    <div className="grp-block">
      <h3 className="grp-block-title">
        Overlays in this group{" "}
        <small className="muted">
          {countOn(offered, group.enabled)} of {offered.length} on
        </small>
      </h3>
      <div className="grp-overlays" role="group" aria-label={`Overlays in ${group.name}`}>
        {offered.map((o) => (
          <label key={o.id} className="grp-check">
            <input
              type="checkbox"
              checked={group.enabled[o.id] === true}
              onChange={(e) => actions.setEnabled(group.id, o.id, e.target.checked)}
            />
            {o.title}
          </label>
        ))}
      </div>
    </div>
  );
}

function GroupName({ group, actions }: { group: LayoutView; actions: LayoutActions }) {
  // Typed text as is; the stored name is trimmed when it is committed.
  const [draft, setDraft] = useState<string | null>(null);
  if (group.isDefault) return <h3 className="grp-name">{group.name}</h3>;
  const commit = (): void => {
    if (draft !== null && draft.trim() !== "" && draft.trim() !== group.name) {
      actions.rename(group.id, draft);
    }
    setDraft(null);
  };
  return (
    <input
      type="text"
      className="grp-input grp-name-input"
      aria-label="Group name"
      maxLength={MAX_LAYOUT_NAME}
      value={draft ?? group.name}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}

function GroupCard({
  group,
  active,
  overlays,
  currentCar,
  actions,
}: {
  group: LayoutView;
  active: boolean;
  overlays: readonly GroupOverlay[];
  currentCar: string | null;
  actions: LayoutActions;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  return (
    <li className="ctl-section grp-card" data-active={active || undefined}>
      <div className="grp-head">
        <GroupName group={group} actions={actions} />
        {active ? (
          <span className="grp-active">Active now</span>
        ) : (
          <span className="grp-inactive">Not active</span>
        )}
        <span className="grp-actions">
          <Button
            variant={active ? "secondary" : "primary"}
            disabled={active}
            onClick={() => actions.activate(group.id)}
          >
            Activate
          </Button>
          <Button onClick={() => actions.duplicate(group.id)}>Duplicate</Button>
          {!group.isDefault && (
            <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
              Delete
            </Button>
          )}
        </span>
      </div>
      {confirmingDelete && (
        <div className="grp-confirm">
          <span>{`Delete ${group.name}? Its positions and overlay choices are lost.`}</span>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmingDelete(false);
              actions.remove(group.id);
            }}
          >
            Delete
          </Button>
          <Button onClick={() => setConfirmingDelete(false)}>Cancel</Button>
        </div>
      )}
      {group.isDefault ? (
        <p className="muted grp-fallback">Used when no other group matches.</p>
      ) : (
        <ActiveWhen group={group} currentCar={currentCar} actions={actions} />
      )}
      <GroupOverlays group={group} overlays={overlays} actions={actions} />
    </li>
  );
}

/** The Overlay groups page itself, separate from the IPC hooks so it renders with a fake state. */
export function LayoutsView({
  state,
  overlays,
  actions,
}: {
  state: LayoutsState;
  /** Every overlay instance the groups can switch on. */
  overlays: readonly GroupOverlay[];
  actions: LayoutActions;
}) {
  const now = contextLabels(state.context);
  return (
    <>
      <p className="muted grp-intro">
        Groups switch automatically by game, session and car type. Positions and which overlays are
        on are kept per group; overlay settings are shared.
      </p>
      <Section title="Current session">
        <Row label="Game">
          <span className="grp-value">{now.game}</span>
        </Row>
        <Row label="Car">
          <span className="grp-value">{now.car}</span>
        </Row>
        <Row label="Car type">
          <span className="grp-value">{now.carType}</span>
        </Row>
        <Row label="Session">
          <span className="grp-value">{now.session}</span>
        </Row>
        <Row
          label="Switch groups automatically"
          help="A group you pick by hand stays until the game, car or session changes."
        >
          <Toggle
            label="Switch groups automatically"
            checked={state.autoSwitch}
            onChange={(on) => actions.setAutoSwitch(on)}
          />
        </Row>
      </Section>
      <ul className="grp-list">
        {state.layouts.map((group) => (
          <GroupCard
            key={group.id}
            group={group}
            active={group.id === state.activeId}
            overlays={overlays}
            currentCar={state.context.carName}
            actions={actions}
          />
        ))}
      </ul>
      <div className="grp-footer">
        <Button variant="primary" onClick={actions.create}>
          New group
        </Button>
        <small className="muted">Starts as a copy of the active group.</small>
      </div>
    </>
  );
}
