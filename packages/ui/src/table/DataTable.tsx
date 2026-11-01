import { memo, useMemo, type CSSProperties, type ReactNode } from "react";
import type { ColumnWidthMode, FieldConfig } from "../types";
import { gridTemplate, orderedColumns, type TableColumn } from "./grid";
import "./table.css";

export interface TableSection<Row> {
  key: string;
  label: ReactNode;
  /** Class colour (locked data colour), used as given. */
  colour: string | null;
  rows: readonly Row[];
}

export interface DataTableProps<Row> {
  columns: readonly TableColumn<Row>[];
  config: readonly FieldConfig[];
  rows?: readonly Row[];
  sections?: readonly TableSection<Row>[];
  rowKey(row: Row): string | number;
  widthMode: ColumnWidthMode;
  /** "Width fine-tune %", 50..150. */
  widthScalePct?: number;
  showHeader: boolean;
  isOwnRow?(row: Row): boolean;
  rowClassName?(row: Row): string | undefined;
  /** Inline style for the row element, e.g. CSS custom properties such as a class colour. */
  rowStyle?(row: Row): CSSProperties | undefined;
}

function alignClass(align: TableColumn<unknown>["align"]): string {
  return align === "right" ? " ov-cell--right" : align === "center" ? " ov-cell--center" : "";
}

interface RowViewProps<Row> {
  row: Row;
  columns: readonly TableColumn<Row>[];
  alt: boolean;
  own: boolean;
  className: string | undefined;
  style: CSSProperties | undefined;
}

function sameStyle(a: CSSProperties | undefined, b: CSSProperties | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  const keys = Object.keys(a) as Array<keyof CSSProperties>;
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((k) => a[k] === b[k]);
}

function sameRowView<Row>(a: RowViewProps<Row>, b: RowViewProps<Row>): boolean {
  return (
    a.row === b.row &&
    a.columns === b.columns &&
    a.alt === b.alt &&
    a.own === b.own &&
    a.className === b.className &&
    sameStyle(a.style, b.style)
  );
}

/**
 * Plain text goes in a span that can shrink and show an ellipsis: `text-overflow` does not apply
 * to the anonymous box of text inside a flex cell. Elements (pills, badges) are left as they are.
 */
function cellContent(node: ReactNode): ReactNode {
  return typeof node === "string" || typeof node === "number" ? (
    <span className="ov-cell-text">{node}</span>
  ) : (
    node
  );
}

/** One body row. Skips rendering while the row object, columns and row decoration are unchanged. */
function RowViewInner<Row>({ row, columns, alt, own, className, style }: RowViewProps<Row>) {
  const classes = ["ov-row", alt ? "ov-row--alt" : "", own ? "ov-row--own" : "", className ?? ""];
  return (
    <div className={classes.filter(Boolean).join(" ")} style={style} role="row">
      {columns.map((column) => (
        <div key={column.id} className={`ov-cell${alignClass(column.align)}`} role="cell">
          {cellContent(column.render(row))}
        </div>
      ))}
    </div>
  );
}
const RowView = memo(RowViewInner, sameRowView) as typeof RowViewInner;

/**
 * One grid for the whole table, rows are `display: contents`, so max-content columns line up
 * across rows and the cells carry the row backgrounds.
 */
export function DataTable<Row>(props: DataTableProps<Row>): JSX.Element {
  const { config, widthMode, showHeader, rowKey, isOwnRow, rowClassName, rowStyle } = props;
  const columns = useMemo(() => orderedColumns(props.columns, config), [props.columns, config]);
  const style: CSSProperties = {
    gridTemplateColumns: gridTemplate(props.columns, config, widthMode, props.widthScalePct ?? 100),
  };

  const renderRows = (rows: readonly Row[]): JSX.Element[] =>
    rows.map((row, index) => (
      <RowView
        key={rowKey(row)}
        row={row}
        columns={columns}
        alt={index % 2 === 1}
        own={isOwnRow?.(row) ?? false}
        className={rowClassName?.(row)}
        style={rowStyle?.(row)}
      />
    ));

  return (
    <div className={`ov-table ov-table--${widthMode}`} style={style} role="table">
      {showHeader ? (
        <div className="ov-row ov-row--header" role="row">
          {columns.map((column) => (
            <div
              key={column.id}
              className={`ov-cell${alignClass(column.align)}`}
              role="columnheader"
            >
              {cellContent(column.label)}
            </div>
          ))}
        </div>
      ) : null}
      {props.sections
        ? props.sections.map((section) => (
            <div key={section.key} className="ov-section" role="rowgroup">
              <div
                className="ov-section-bar"
                style={
                  section.colour
                    ? ({ "--ov-section-colour": section.colour } as CSSProperties)
                    : undefined
                }
              >
                {section.label}
              </div>
              {renderRows(section.rows)}
            </div>
          ))
        : renderRows(props.rows ?? [])}
    </div>
  );
}
