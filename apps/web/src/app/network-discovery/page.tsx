'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';

import { ErrorState, LoadingState } from '@/components/page-state';
import { RelativeTime } from '@/components/relative-time';
import {
  createNetworkDiscoveryProfile,
  getNetworkDiscoveryProfiles,
  getNetworkDiscoveryRun,
  getNetworkDiscoveryRuns,
  NetworkDiscoveryMethod,
  NetworkDiscoveryMode,
  NetworkDiscoveryProfile,
  NetworkDiscoveryRun,
  NetworkDiscoveryRunDetail,
  runNetworkDiscoveryProfile,
} from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import {
  getDiscoveryMethodLabel,
  getDiscoveryModeLabel,
  getDiscoveryResultStatusLabel,
  getDiscoveryRunStatusLabel,
} from '@/lib/labels';

const discoveryMethods: NetworkDiscoveryMethod[] = [
  'ICMP_SIMULATED',
  'DNS_REVERSE_SIMULATED',
  'ARP_SIMULATED',
];

type ProfileForm = {
  name: string;
  description: string;
  mode: NetworkDiscoveryMode;
  allowedCidrs: string;
  deniedCidrs: string;
  rateLimitPerMinute: string;
  enabled: boolean;
  methods: NetworkDiscoveryMethod[];
};

const initialForm: ProfileForm = {
  name: '',
  description: '',
  mode: 'LIGHT',
  allowedCidrs: '10.20.0.0/24',
  deniedCidrs: '',
  rateLimitPerMinute: '10',
  enabled: true,
  methods: ['ICMP_SIMULATED', 'DNS_REVERSE_SIMULATED', 'ARP_SIMULATED'],
};

function parseCidrs(value: string): string[] {
  return value
    .split(/[\s,;]+/)
    .map((cidr) => cidr.trim())
    .filter(Boolean);
}

export default function NetworkDiscoveryPage() {
  const [profiles, setProfiles] = useState<NetworkDiscoveryProfile[]>([]);
  const [runs, setRuns] = useState<NetworkDiscoveryRun[]>([]);
  const [selectedRun, setSelectedRun] = useState<NetworkDiscoveryRunDetail | null>(null);
  const [form, setForm] = useState<ProfileForm>(initialForm);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [runningProfileId, setRunningProfileId] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    let active = true;
    void Promise.all([getNetworkDiscoveryProfiles(), getNetworkDiscoveryRuns()])
      .then(([loadedProfiles, loadedRuns]) => {
        if (!active) return;
        setProfiles(loadedProfiles);
        setRuns(loadedRuns);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Erro inesperado.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [requestVersion]);

  function retry(): void {
    setLoading(true);
    setError(null);
    setRequestVersion((version) => version + 1);
  }

  async function refreshLists(): Promise<void> {
    const [loadedProfiles, loadedRuns] = await Promise.all([
      getNetworkDiscoveryProfiles(),
      getNetworkDiscoveryRuns(),
    ]);
    setProfiles(loadedProfiles);
    setRuns(loadedRuns);
  }

  async function submitProfile(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setFormError(null);
    setMessage(null);
    try {
      await createNetworkDiscoveryProfile({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        enabled: form.enabled,
        mode: form.mode,
        allowedCidrs: parseCidrs(form.allowedCidrs),
        deniedCidrs: parseCidrs(form.deniedCidrs),
        rateLimitPerMinute: Number(form.rateLimitPerMinute),
        methods: form.methods,
        scheduleEnabled: false,
      });
      setForm(initialForm);
      setMessage('Perfil de descoberta criado com segurança.');
      await refreshLists();
    } catch (submitError: unknown) {
      setFormError(
        submitError instanceof Error ? submitError.message : 'Não foi possível criar o perfil.',
      );
    } finally {
      setSaving(false);
    }
  }

  function toggleMethod(method: NetworkDiscoveryMethod): void {
    setForm((current) => ({
      ...current,
      methods: current.methods.includes(method)
        ? current.methods.filter((item) => item !== method)
        : [...current.methods, method],
    }));
  }

  async function executeProfile(profile: NetworkDiscoveryProfile): Promise<void> {
    setRunningProfileId(profile.id);
    setFormError(null);
    setMessage(null);
    try {
      const run = await runNetworkDiscoveryProfile(profile.id);
      setSelectedRun(run);
      setMessage('Descoberta simulada concluída. Nenhum tráfego real foi enviado à rede.');
      await refreshLists();
    } catch (runError: unknown) {
      setFormError(
        runError instanceof Error ? runError.message : 'Não foi possível executar o perfil.',
      );
    } finally {
      setRunningProfileId(null);
    }
  }

  async function showRun(runId: string): Promise<void> {
    setFormError(null);
    try {
      setSelectedRun(await getNetworkDiscoveryRun(runId));
    } catch (runError: unknown) {
      setFormError(
        runError instanceof Error ? runError.message : 'Não foi possível abrir a execução.',
      );
    }
  }

  if (loading) {
    return (
      <main className="page-shell">
        <LoadingState label="Carregando descoberta de rede…" />
      </main>
    );
  }
  if (error) {
    return (
      <main className="page-shell">
        <ErrorState message={error} retry={retry} />
      </main>
    );
  }

  return (
    <main className="page-shell">
      <header className="page-heading">
        <div>
          <p className="eyebrow">Descoberta segura e controlada</p>
          <h1>Descoberta de rede</h1>
          <p className="page-description">
            Configure apenas escopos privados RFC1918 e execute observações simuladas, limitadas e
            auditáveis. Esta versão não envia tráfego real para a rede.
          </p>
        </div>
        <div className="summary-pill">
          <strong>{profiles.length}</strong>
          <span>perfis configurados</span>
        </div>
      </header>

      <section className="discovery-safety-note">
        <strong>Modo seguro do MVP</strong>
        <span>
          Sem scan real, autenticação, comandos remotos ou coleta de credenciais. O agendamento está
          modelado, mas ainda não executa automaticamente.
        </span>
      </section>

      {formError ? <p className="form-message form-error discovery-message">{formError}</p> : null}
      {message ? <p className="form-message form-success discovery-message">{message}</p> : null}

      <section className="panel discovery-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">Configuração</p>
            <h2>Novo perfil</h2>
          </div>
        </div>
        <form className="discovery-profile-form" onSubmit={submitProfile}>
          <label>
            <span>Nome</span>
            <input
              required
              maxLength={120}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="Rede administrativa"
            />
          </label>
          <label>
            <span>Descrição</span>
            <input
              maxLength={500}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
              placeholder="Escopo controlado para demonstração"
            />
          </label>
          <label>
            <span>Modo de registro simulado</span>
            <select
              value={form.mode}
              onChange={(event) =>
                setForm({ ...form, mode: event.target.value as NetworkDiscoveryMode })
              }
            >
              <option value="PASSIVE">Passivo</option>
              <option value="LIGHT">Leve</option>
              <option value="CONTROLLED">Controlado</option>
            </select>
          </label>
          <label>
            <span>Limite por minuto</span>
            <input
              required
              type="number"
              min="1"
              max="60"
              value={form.rateLimitPerMinute}
              onChange={(event) => setForm({ ...form, rateLimitPerMinute: event.target.value })}
            />
          </label>
          <label className="discovery-wide-field">
            <span>CIDRs permitidos</span>
            <textarea
              required
              value={form.allowedCidrs}
              onChange={(event) => setForm({ ...form, allowedCidrs: event.target.value })}
              placeholder="10.20.0.0/24, 172.16.10.0/24"
            />
          </label>
          <label className="discovery-wide-field">
            <span>CIDRs negados</span>
            <textarea
              value={form.deniedCidrs}
              onChange={(event) => setForm({ ...form, deniedCidrs: event.target.value })}
              placeholder="10.20.0.128/25"
            />
          </label>
          <fieldset className="discovery-methods">
            <legend>Métodos simulados</legend>
            {discoveryMethods.map((method) => (
              <label key={method}>
                <input
                  type="checkbox"
                  checked={form.methods.includes(method)}
                  onChange={() => toggleMethod(method)}
                />
                {getDiscoveryMethodLabel(method)}
              </label>
            ))}
          </fieldset>
          <label className="discovery-enabled">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(event) => setForm({ ...form, enabled: event.target.checked })}
            />
            <span>Perfil habilitado</span>
          </label>
          <div className="form-actions">
            <button
              className="button button-primary"
              type="submit"
              disabled={saving || form.methods.length === 0}
            >
              {saving ? 'Salvando…' : 'Criar perfil'}
            </button>
          </div>
        </form>
      </section>

      <section className="panel full-panel discovery-panel">
        <div className="panel-heading">
          <div>
            <p className="section-kicker">Escopos autorizados</p>
            <h2>Perfis de descoberta</h2>
          </div>
        </div>
        {profiles.length === 0 ? (
          <p className="muted-copy">Nenhum perfil configurado.</p>
        ) : (
          <div className="discovery-profile-grid">
            {profiles.map((profile) => (
              <article className="discovery-profile-card" key={profile.id}>
                <div className="discovery-card-heading">
                  <div>
                    <h3>{profile.name}</h3>
                    <p>{profile.description ?? 'Sem descrição.'}</p>
                  </div>
                  <span className={profile.enabled ? 'enabled-chip' : 'disabled-chip'}>
                    {profile.enabled ? 'Habilitado' : 'Desabilitado'}
                  </span>
                </div>
                <dl>
                  <div>
                    <dt>Modo simulado</dt>
                    <dd>{getDiscoveryModeLabel(profile.mode)}</dd>
                  </div>
                  <div>
                    <dt>Limite</dt>
                    <dd>{profile.rateLimitPerMinute}/min</dd>
                  </div>
                  <div>
                    <dt>Execuções</dt>
                    <dd>{profile._count?.runs ?? 0}</dd>
                  </div>
                </dl>
                <div className="discovery-scope">
                  <strong>CIDRs permitidos</strong>
                  {profile.allowedCidrs.map((cidr) => (
                    <code key={cidr}>{cidr}</code>
                  ))}
                </div>
                <div className="discovery-method-list">
                  {profile.methods.map((method) => (
                    <span key={method}>{getDiscoveryMethodLabel(method)}</span>
                  ))}
                </div>
                <button
                  className="button button-primary"
                  type="button"
                  disabled={!profile.enabled || runningProfileId !== null}
                  onClick={() => void executeProfile(profile)}
                >
                  {runningProfileId === profile.id
                    ? 'Executando simulação…'
                    : 'Executar descoberta'}
                </button>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="table-panel full-panel" aria-label="Histórico de descobertas">
        <div className="panel-heading discovery-table-heading">
          <div>
            <p className="section-kicker">Auditoria operacional</p>
            <h2>Histórico de execuções</h2>
          </div>
        </div>
        {runs.length === 0 ? (
          <p className="muted-copy discovery-empty-copy">Nenhuma execução registrada.</p>
        ) : (
          <div className="table-scroll">
            <table className="assets-table">
              <thead>
                <tr>
                  <th>Perfil</th>
                  <th>Status</th>
                  <th>Início</th>
                  <th>Fim</th>
                  <th className="number-column">Alvos</th>
                  <th className="number-column">Encontrados</th>
                  <th className="number-column">Criados</th>
                  <th className="number-column">Atualizados</th>
                  <th className="number-column">Erros</th>
                  <th>Ação</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr key={run.id}>
                    <td>{run.profile.name}</td>
                    <td>
                      <span className="conflict-chip">
                        {getDiscoveryRunStatusLabel(run.status)}
                      </span>
                    </td>
                    <td>
                      {formatDateTime(run.startedAt)}
                      <RelativeTime className="cell-subtitle" value={run.startedAt} />
                    </td>
                    <td>{formatDateTime(run.finishedAt)}</td>
                    <td className="number-column">{run.totalTargets}</td>
                    <td className="number-column">{run.discoveredCount}</td>
                    <td className="number-column">{run.createdAssetCount}</td>
                    <td className="number-column">{run.updatedAssetCount}</td>
                    <td className="number-column">{run.errorCount}</td>
                    <td>
                      <button
                        className="table-link-button"
                        type="button"
                        onClick={() => void showRun(run.id)}
                      >
                        Ver detalhes
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedRun ? (
        <section className="panel full-panel discovery-panel" id="run-details">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Resultados simulados</p>
              <h2>Detalhes da execução</h2>
              <p className="muted-copy">
                {selectedRun.profile.name} · {formatDateTime(selectedRun.startedAt)}
              </p>
            </div>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => setSelectedRun(null)}
            >
              Fechar
            </button>
          </div>
          <div className="table-scroll">
            <table className="assets-table">
              <thead>
                <tr>
                  <th>Hostname</th>
                  <th>IP</th>
                  <th>MAC</th>
                  <th>Método</th>
                  <th>Confiança</th>
                  <th>Resultado</th>
                  <th>Ativo relacionado</th>
                </tr>
              </thead>
              <tbody>
                {selectedRun.results.map((result) => (
                  <tr key={result.id}>
                    <td>{result.hostname ?? 'Não identificado'}</td>
                    <td>
                      <code>{result.ipAddress}</code>
                    </td>
                    <td>
                      <code>{result.macAddress ?? '—'}</code>
                    </td>
                    <td>{getDiscoveryMethodLabel(result.method)}</td>
                    <td>
                      {result.confidenceScore === null
                        ? '—'
                        : `${Math.round(result.confidenceScore)}%`}
                    </td>
                    <td>{getDiscoveryResultStatusLabel(result.status)}</td>
                    <td>
                      {result.asset ? (
                        <Link className="asset-name" href={`/assets/${result.asset.id}`}>
                          {result.asset.name}
                        </Link>
                      ) : (
                        'Sem vínculo'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}
