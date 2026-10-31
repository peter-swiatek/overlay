import type { CSSProperties, ReactNode } from "react";
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

/**
 * One grid for the whole table, rows are `display: contents`, so max-content columns line up
 * across rows and the cells carry the row backgrounds.
 */
export function DataTable<Row>(props: DataTableProps<Row>): JSX.Element {
  const { config, widthMode, showHeader, rowKey, isOwnRow, rowClassName, rowStyle } = props;
  const columns = orderedColumns(props.columns, config);
  const style: CSSProperties = {
    gridTemplateColumns: gridTemplate(props.columns, config, widthMode, props.widthScalePct ?? 100),
  };

  const renderRows = (rows: readonly Row[]): JSX.Element[] =>
    rows.map((row, index) => {
      const classes = [
        "ov-row",
        index % 2 === 1 ? "ov-row--alt" : "",
        isOwnRow?.(row) ? "ov-row--own" : "",
        rowClassName?.(row) ?? "",
      ];
      return (
        <div
          key={rowKey(row)}
          className={classes.filter(Boolean).join(" ")}
          style={rowStyle?.(row)}
          role="row"
        >
          {columns.map((column) => (
            <div key={column.id} className={`ov-cell${alignClass(column.align)}`} role="cell">
              {column.render(row)}
            </div>
          ))}
        </div>
      );
    });

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
              {column.label}
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
