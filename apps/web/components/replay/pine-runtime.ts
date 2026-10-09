import type { Bar, PineIndicator, Session } from "./types";
export type PineInput = {
  id: string;
  name: string;
  title?: string;
  group?: string;
  inline?: string;
  tooltip?: string;
  display?: string;
  type: string;
  defval: number | string | boolean;
  options?: (number | string)[];
  minval?: number;
  maxval?: number;
  step?: number;
};
export type PinePlot = {
  key: string;
  title: string;
  style: "line" | "histogram";
  step: boolean;
  breakLine: boolean;
  overlay: boolean;
  color: string;
  width: 1 | 2 | 3 | 4;
  data: { time: number; value: number | null; color: string }[];
};
export type PineDrawing = {
  kind: "line" | "box" | "label";
  xloc: "bi" | "bt";
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  left?: number;
  top?: number;
  right?: number;
  bottom?: number;
  x?: number;
  y?: number;
  color?: string;
  style?: string;
  extend?: string;
  width?: number;
  border_color?: string;
  border_style?: string;
  border_width?: number;
  bgcolor?: string;
  text?: string;
  text_color?: string;
  text_size?: string;
  text_halign?: string;
  text_valign?: string;
  yloc?: string;
  textcolor?: string;
  size?: string;
  textalign?: string;
};
export type PineResult = {
  settingsTitle: string;
  pineVersion: 5 | 6;
  title: string;
  overlay: boolean;
  inputs: PineInput[];
  plots: PinePlot[];
  drawings: PineDrawing[];
  backgrounds: { time: number; color: string }[];
};
export type PineReply = { id: string; result?: PineResult; error?: string };
export function pineRequest(
  session: Session,
  items: Pick<PineIndicator, "id" | "source" | "inputs">[],
) {
  const tf = session.config.timeframe || session.dataset.timeframe;
  const seconds =
    { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400 }[
      tf
    ] || 300;
  return {
    items,
    bars: session.bars,
    timeframe: tf,
    symbol: session.dataset.symbol,
    clock:
      session.quote?.time_ms ??
      session.replay_time_ms ??
      (session.bars.at(-1)!.time + seconds) * 1000,
  };
}
let runtime: Promise<string> | undefined;
function bundle() {
  return (runtime ??= fetch("/api/pine-runtime", {
    signal: AbortSignal.timeout(5000),
  })
    .then(async (r) => {
      if (!r.ok) throw Error("โหลด Pine runtime ไม่ได้");
      return r.text();
    })
    .catch((e) => {
      runtime = undefined;
      throw e;
    }));
}
/** Opaque iframe owns a blob Worker. User code never runs with the app's origin. */
export class PineSandbox {
  private frame?: HTMLIFrameElement;
  private ready?: Promise<void>;
  private disposed = false;
  private token = crypto.randomUUID();
  private serial = 0;
  private pending?: {
    id: number;
    resolve: (r: PineReply[]) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  private onMessage = (e: MessageEvent) => {
    if (e.source !== this.frame?.contentWindow || e.data?.token !== this.token)
      return;
    const p = this.pending;
    if (p && e.data.id === p.id) {
      clearTimeout(p.timer);
      this.pending = undefined;
      if (e.data.error) p.reject(Error(e.data.error));
      else p.resolve(e.data.results);
    }
  };
  private async init() {
    if (this.disposed) throw Error("Pine runtime ปิดแล้ว");
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const worker = await bundle();
      if (this.disposed) throw Error("Pine runtime ปิดแล้ว");
      const frame = document.createElement("iframe");
      this.frame = frame;
      frame.setAttribute("sandbox", "allow-scripts");
      frame.setAttribute("aria-hidden", "true");
      frame.hidden = true;
      // Only trusted bootstrap is inserted; user source travels via structured messages.
      const literal = JSON.stringify(worker).replace(/</g, "\\u003c");
      const token = JSON.stringify(this.token);
      frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none';"><script>const token=${token};const url=URL.createObjectURL(new Blob([${literal}],{type:'text/javascript'}));const worker=new Worker(url);URL.revokeObjectURL(url);worker.onmessage=e=>parent.postMessage({...e.data,token},'*');worker.onerror=e=>parent.postMessage({id:current,error:e.message||'Pine Worker error',token},'*');let current=0;onmessage=e=>{if(e.source!==parent||e.data.token!==token)return;current=e.data.id;worker.postMessage(e.data);};</script>`;
      window.addEventListener("message", this.onMessage);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error("โหลด Pine sandbox ไม่ทัน")),
          5000,
        );
        frame.onload = () => {
          clearTimeout(timer);
          resolve();
        };
        document.body.append(frame);
      });
    })();
    return this.ready;
  }
  async run(request: {
    items: Pick<PineIndicator, "id" | "source" | "inputs">[];
    bars: Bar[];
    symbol: string;
    timeframe: string;
    clock: number;
  }): Promise<PineReply[]> {
    await this.init();
    if (this.disposed) throw Error("Pine runtime ปิดแล้ว");
    if (this.pending) throw Error("Pine กำลังคำนวณ");
    return new Promise((resolve, reject) => {
      const id = ++this.serial;
      const timer = setTimeout(() => {
        this.pending = undefined;
        this.dispose();
        reject(Error("สคริปต์ใช้เวลาเกิน 5 วินาที หยุดแล้ว กรุณาลดการคำนวณ"));
      }, 5000);
      this.pending = { id, resolve, reject, timer };
      this.frame!.contentWindow!.postMessage(
        { ...request, id, token: this.token },
        "*",
      );
    });
  }
  dispose() {
    this.disposed = true;
    window.removeEventListener("message", this.onMessage);
    this.frame?.remove();
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(Error("Pine runtime ปิดแล้ว"));
      this.pending = undefined;
    }
  }
}
