/*
 * Layout constants come from iRacing's freely distributed SDK header `irsdk_defines.h`
 * (struct irsdk_header, struct irsdk_varBuf, struct irsdk_varHeader). Only the public fields
 * needed to copy the data are read; the payloads themselves are stored raw.
 */
export const IRSDK_MAP_NAME = "Local\\IRSDKMemMapFileName";
export const IRSDK_EVENT_NAME = "Local\\IRSDKDataValidEvent";
export const IRSDK_HEADER_BYTES = 112;
export const IRSDK_VAR_HEADER_BYTES = 144;
export const IRSDK_MAX_BUFS = 4;
/** irsdk_StatusField::irsdk_stConnected */
export const IRSDK_ST_CONNECTED = 1;
export const IRSDK_EVENT_TIMEOUT_MS = 200;

const OFF = {
  ver: 0,
  status: 4,
  tickRate: 8,
  sessionInfoUpdate: 12,
  sessionInfoLen: 16,
  sessionInfoOffset: 20,
  numVars: 24,
  varHeaderOffset: 28,
  numBuf: 32,
  bufLen: 36,
  varBuf: 48,
} as const;
const VAR_BUF_ENTRY_BYTES = 16;

export interface IrsdkVarBuf {
  tickCount: number;
  bufOffset: number;
}

export interface IrsdkHeader {
  ver: number;
  status: number;
  tickRate: number;
  sessionInfoUpdate: number;
  sessionInfoLen: number;
  sessionInfoOffset: number;
  numVars: number;
  varHeaderOffset: number;
  numBuf: number;
  bufLen: number;
  varBuf: IrsdkVarBuf[];
}

export function parseIrsdkHeader(buf: Buffer): IrsdkHeader {
  const varBuf: IrsdkVarBuf[] = [];
  for (let i = 0; i < IRSDK_MAX_BUFS; i++) {
    const at = OFF.varBuf + i * VAR_BUF_ENTRY_BYTES;
    varBuf.push({ tickCount: buf.readInt32LE(at), bufOffset: buf.readInt32LE(at + 4) });
  }
  return {
    ver: buf.readInt32LE(OFF.ver),
    status: buf.readInt32LE(OFF.status),
    tickRate: buf.readInt32LE(OFF.tickRate),
    sessionInfoUpdate: buf.readInt32LE(OFF.sessionInfoUpdate),
    sessionInfoLen: buf.readInt32LE(OFF.sessionInfoLen),
    sessionInfoOffset: buf.readInt32LE(OFF.sessionInfoOffset),
    numVars: buf.readInt32LE(OFF.numVars),
    varHeaderOffset: buf.readInt32LE(OFF.varHeaderOffset),
    numBuf: buf.readInt32LE(OFF.numBuf),
    bufLen: buf.readInt32LE(OFF.bufLen),
    varBuf,
  };
}

/** Index of the var buffer with the highest tickCount, or -1 when there is none. */
export function newestVarBuf(header: IrsdkHeader): number {
  const count = Math.min(Math.max(header.numBuf, 0), IRSDK_MAX_BUFS);
  let best = -1;
  for (let i = 0; i < count; i++) {
    const entry = header.varBuf[i];
    if (entry && (best < 0 || entry.tickCount > (header.varBuf[best]?.tickCount ?? -1))) best = i;
  }
  return best;
}
