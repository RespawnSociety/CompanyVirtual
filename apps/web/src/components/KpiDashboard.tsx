/**
 * KpiDashboard (roadmap 5.4) — pantau biaya LLM + aktivitas + status agent per company/departemen.
 *
 * Biaya = ESTIMASI: token nyata (9Router `usage`) × tarif per-tier (diatur di .env). Token
 * ditampilkan apa adanya sebagai sinyal utama; biaya rupiah sebagai perkiraan. Refetch saat
 * `refreshTick` berubah (agent:event / pengiriman arahan).
 */

import { useEffect, useState } from "react";
import type { KpiReport } from "@vc/shared";
import { api } from "../api.js";

function fmt(n: number): string {
  return n.toLocaleString("id-ID");
}

function money(n: number, currency: string): string {
  return `${currency} ${n.toLocaleString("id-ID", { maximumFractionDigits: 2 })}`;
}

/** Kartu metrik ringkas. */
function Stat({ label, value, hint }: { label: string; value: string; hint?: string }): JSX.Element {
  return (
    <div className="card" style={{ flex: 1, minWidth: 130 }}>
      <div className="sub">{label}</div>
      <div className="title" style={{ fontSize: 20 }}>{value}</div>
      {hint && <div className="muted" style={{ fontSize: 11 }}>{hint}</div>}
    </div>
  );
}

export function KpiDashboard({
  companyId,
  refreshTick = 0,
}: {
  companyId: string | null;
  refreshTick?: number;
}): JSX.Element {
  const [kpi, setKpi] = useState<KpiReport | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!companyId) {
      setKpi(null);
      setLoaded(false);
      return;
    }
    setLoaded(false);
    let ignore = false;
    api
      .getKpi(companyId)
      .then((r) => {
        if (!ignore) {
          setKpi(r);
          setError(null);
        }
      })
      .catch((e: unknown) => {
        if (!ignore) {
          setKpi(null);
          setError(e instanceof Error ? e.message : String(e));
        }
      })
      .finally(() => {
        if (!ignore) setLoaded(true);
      });
    return () => {
      ignore = true;
    };
  }, [companyId, refreshTick]);

  if (!companyId) {
    return (
      <div className="panel">
        <p className="empty">Pilih company dulu.</p>
      </div>
    );
  }
  if (!loaded) {
    return (
      <div className="panel">
        <p className="muted">Memuat KPI…</p>
      </div>
    );
  }
  if (error || !kpi) {
    return (
      <div className="panel">
        <div className="error">Gagal memuat KPI{error ? `: ${error}` : ""}.</div>
      </div>
    );
  }

  const cur = kpi.rates.currency;
  const noUsage = kpi.total.totalTokens === 0 && kpi.total.llmCalls === 0;
  const maxDayTokens = Math.max(1, ...kpi.byDay.map((d) => d.cost.totalTokens));

  return (
    <>
      <div className="panel">
        <h2>Ringkasan biaya & kinerja</h2>
        {noUsage && (
          <p className="hint">
            Belum ada pemakaian LLM tercatat. Kirim arahan ke departemen/karakter (butuh 9Router
            hidup) — biaya & aktivitas akan muncul di sini.
          </p>
        )}
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <Stat label="Total token" value={fmt(kpi.total.totalTokens)} hint={`${fmt(kpi.total.llmCalls)} panggilan LLM`} />
          <Stat label="Estimasi biaya" value={money(kpi.total.estimatedCost, cur)} hint="tarif diatur di .env" />
          <Stat label="Task selesai" value={fmt(kpi.activity.tasksDone)} hint={`${fmt(kpi.activity.tasksTotal)} total · ${fmt(kpi.activity.tasksBlocked)} blocked`} />
          <Stat label="Konten dibuat" value={fmt(kpi.activity.artifacts)} />
          <Stat label="Aksi eksternal" value={fmt(kpi.activity.externalActions)} hint={`${fmt(kpi.activity.approvalsDecided)} approval diputuskan`} />
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          <Stat label="Agent total" value={fmt(kpi.agents.total)} />
          <Stat label="Working" value={fmt(kpi.agents.working)} />
          <Stat label="Idle" value={fmt(kpi.agents.idle)} />
          <Stat label="Blocked" value={fmt(kpi.agents.blocked)} hint={kpi.agents.blocked > 0 ? "perlu perhatian" : undefined} />
        </div>
        <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
          Tarif/1k token — subscription: {money(kpi.rates.perThousandTokens.subscription, cur)} ·
          cheap: {money(kpi.rates.perThousandTokens.cheap, cur)} ·
          free: {money(kpi.rates.perThousandTokens.free, cur)}
        </p>
      </div>

      <div className="panel">
        <h2>Biaya per hari kerja</h2>
        {kpi.byDay.length === 0 ? (
          <p className="empty">Belum ada data harian.</p>
        ) : (
          <div className="list">
            {kpi.byDay.map((d) => (
              <div className="row" key={d.day} style={{ alignItems: "center", gap: 8 }}>
                <span className="sub" style={{ width: 92 }}>{d.day}</span>
                <div style={{ flex: 1, background: "#0f1420", borderRadius: 6, height: 16, position: "relative" }}>
                  <div
                    style={{
                      width: `${(d.cost.totalTokens / maxDayTokens) * 100}%`,
                      background: "#4f7cff",
                      height: "100%",
                      borderRadius: 6,
                      minWidth: d.cost.totalTokens > 0 ? 2 : 0,
                    }}
                  />
                </div>
                <span className="muted" style={{ width: 110, textAlign: "right", fontSize: 12 }}>
                  {fmt(d.cost.totalTokens)} tok
                </span>
                <span className="muted" style={{ width: 110, textAlign: "right", fontSize: 12 }}>
                  {money(d.cost.estimatedCost, cur)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Per departemen ({kpi.departments.length})</h2>
        {kpi.departments.length === 0 ? (
          <p className="empty">Belum ada departemen.</p>
        ) : (
          <div className="list">
            {kpi.departments.map((d) => (
              <div className="card" key={d.departmentId}>
                <div className="title">
                  {d.name} {d.templateId && <span className="badge accent">template</span>}
                </div>
                <div className="sub" style={{ marginTop: 4 }}>
                  {fmt(d.cost.totalTokens)} token · {fmt(d.cost.llmCalls)} panggilan ·{" "}
                  {money(d.cost.estimatedCost, cur)}
                </div>
                <div style={{ marginTop: 6 }}>
                  <span className="badge">task: {fmt(d.activity.tasksDone)}/{fmt(d.activity.tasksTotal)}</span>{" "}
                  <span className="badge">konten: {fmt(d.activity.artifacts)}</span>{" "}
                  <span className="badge">eksternal: {fmt(d.activity.externalActions)}</span>{" "}
                  <span className="badge">agent: {fmt(d.agents.total)}</span>{" "}
                  {d.agents.working > 0 && <span className="badge accent">working {fmt(d.agents.working)}</span>}{" "}
                  {d.agents.blocked > 0 && <span className="badge risky">blocked {fmt(d.agents.blocked)}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
