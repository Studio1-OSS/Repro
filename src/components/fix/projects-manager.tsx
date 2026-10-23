"use client";

import { FolderGit2, Github, Pencil, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Project = {
  id: string;
  name: string;
  origins: string[];
  sourceType: "local" | "github";
  localPath: string | null;
  githubRepo: string | null;
  githubBranch: string | null;
  githubToken: boolean;
  checkCommand: string | null;
  startCommand: string | null;
  appPort: number | null;
  signInPath: string | null;
  signInEmail: string | null;
  signInPassword: boolean;
  webhookUrl: string | null;
};

const input = "h-10 w-full border border-card-border bg-canvas px-3 text-ui outline-none focus:border-primary";

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 text-ui text-ink-2">
      <span>
        {label}
        {hint && <span className="ml-2 text-caption text-ink-3">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function ProjectsManager({ initial, selfHosted, prefillOrigin }: { initial: Project[]; selfHosted: boolean; prefillOrigin?: string }) {
  const [projects, setProjects] = React.useState(initial);
  const [editing, setEditing] = React.useState<Project | "new" | null>(prefillOrigin && !initial.some((p) => p.origins.includes(prefillOrigin)) ? "new" : null);

  return (
    <div className="mt-8 grid gap-4">
      {projects.map((p) => (
        <div key={p.id} className="flex flex-wrap items-start gap-4 bg-fog p-5">
          {p.sourceType === "github" ? <Github className="mt-0.5 size-5" /> : <FolderGit2 className="mt-0.5 size-5" />}
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{p.name}</p>
            <p className="mt-0.5 break-all text-caption text-ink-2">{p.sourceType === "github" ? `${p.githubRepo}@${p.githubBranch}${p.githubToken ? " · token set" : " · public, read-only"}` : p.localPath}</p>
            <p className="mt-1 text-caption text-ink-3">
              Pages: {p.origins.join(", ")}
              {p.checkCommand ? ` · tests: ${p.checkCommand}` : ""}
              {p.startCommand ? ` · start: ${p.startCommand} (port ${p.appPort})` : ""}
              {p.webhookUrl ? " · webhook on" : ""}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setEditing(p)}>
            <Pencil /> Edit
          </Button>
          <Button
            size="sm"
            variant="quiet"
            aria-label="Delete"
            onClick={async () => {
              if (!confirm(`Delete ${p.name}? Its fixes stay on their reports.`)) return;
              await fetch(`/api/projects/${p.id}`, { method: "DELETE" });
              setProjects((list) => list.filter((x) => x.id !== p.id));
            }}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      {projects.length === 0 && editing === null && <p className="bg-canvas-soft p-6 text-ui text-ink-2">No projects yet. Add one to let Repro fix bugs in your code.</p>}
      {editing === null ? (
        <div>
          <Button onClick={() => setEditing("new")}>
            <Plus /> Add a project
          </Button>
        </div>
      ) : (
        <ProjectForm
          key={editing === "new" ? "new" : editing.id}
          project={editing === "new" ? null : editing}
          prefillOrigin={prefillOrigin}
          selfHosted={selfHosted}
          onCancel={() => setEditing(null)}
          onSaved={(p) => {
            setProjects((list) => [p, ...list.filter((x) => x.id !== p.id)]);
            setEditing(null);
            toast.success("Project saved");
          }}
        />
      )}
    </div>
  );
}

function ProjectForm({ project, prefillOrigin, selfHosted, onCancel, onSaved }: { project: Project | null; prefillOrigin?: string; selfHosted: boolean; onCancel: () => void; onSaved: (p: Project) => void }) {
  const [type, setType] = React.useState<"local" | "github">(project?.sourceType ?? (selfHosted ? "local" : "github"));
  const [saving, setSaving] = React.useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>;
    const body = {
      ...f,
      sourceType: type,
      origins: f.origins.split(/[\s,]+/).filter(Boolean),
      appPort: f.appPort ? Number(f.appPort) : "",
    };
    const res = await fetch(project ? `/api/projects/${project.id}` : "/api/projects", { method: project ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    setSaving(false);
    if (!res.ok) return toast.error(out.error ?? "Couldn't save");
    onSaved(out.project);
  }

  return (
    <form onSubmit={submit} className="grid gap-5 border border-card-border p-6">
      <p className="text-subhead font-semibold">{project ? `Edit ${project.name}` : "New project"}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name">
          <input name="name" required defaultValue={project?.name ?? ""} placeholder="Storefront" className={input} />
        </Field>
        <Field label="Pages it serves" hint="origins, comma-separated">
          <input name="origins" required defaultValue={project?.origins.join(", ") ?? prefillOrigin ?? ""} placeholder="http://localhost:3001, https://shop.example.com" className={input} />
        </Field>
      </div>

      <div>
        <p className="text-ui text-ink-2">Where the code lives</p>
        <div className="mt-2 flex gap-2">
          {(["local", "github"] as const).map((t) => (
            <button key={t} type="button" disabled={t === "local" && !selfHosted} onClick={() => setType(t)} className={cn("h-9 rounded-full px-4 text-ui disabled:opacity-40", type === t ? "bg-ink text-white" : "bg-fog text-ink-2")}>
              {t === "local" ? "Folder on this machine" : "GitHub repository"}
            </button>
          ))}
        </div>
      </div>
      {type === "local" ? (
        <Field label="Folder" hint="absolute path; fixes can be applied straight to it">
          <input name="localPath" required defaultValue={project?.localPath ?? ""} placeholder="/Users/you/code/storefront" className={input} />
        </Field>
      ) : (
        <div className="grid gap-4 sm:grid-cols-[2fr_1fr]">
          <Field label="Repository" hint="owner/name">
            <input name="githubRepo" required defaultValue={project?.githubRepo ?? ""} placeholder="acme/storefront" className={input} />
          </Field>
          <Field label="Branch">
            <input name="githubBranch" defaultValue={project?.githubBranch ?? "main"} className={input} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Token" hint={project?.githubToken ? "set; leave empty to keep, '-' to remove" : "fine-grained: Contents and Pull requests read/write. Optional for public repos (no PRs)."}>
              <input name="githubToken" type="password" autoComplete="off" placeholder={project?.githubToken ? "••••••••" : "github_pat_…"} className={input} />
            </Field>
          </div>
        </div>
      )}

      <div className="grid gap-4 border-t border-hairline pt-5 sm:grid-cols-[2fr_2fr_1fr]">
        <Field label="Test command" hint="sandbox">
          <input name="checkCommand" defaultValue={project?.checkCommand ?? ""} placeholder="npm ci && npm test" className={input} />
        </Field>
        <Field label="Start command" hint="sandbox; listens on $PORT">
          <input name="startCommand" defaultValue={project?.startCommand ?? ""} placeholder="npm ci && npm start" className={input} />
        </Field>
        <Field label="Port">
          <input name="appPort" type="number" defaultValue={project?.appPort ?? ""} placeholder="3000" className={input} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Sign-in page" hint="optional, for the sandbox">
          <input name="signInPath" defaultValue={project?.signInPath ?? ""} placeholder="/login" className={input} />
        </Field>
        <Field label="Test account email">
          <input name="signInEmail" defaultValue={project?.signInEmail ?? ""} className={input} />
        </Field>
        <Field label="Test account password" hint={project?.signInPassword ? "set" : undefined}>
          <input name="signInPassword" type="password" autoComplete="off" placeholder={project?.signInPassword ? "••••••••" : ""} className={input} />
        </Field>
      </div>
      <p className="-mt-2 text-caption text-ink-3">The sandbox signs in with a script before the agent starts. The model never sees or types the password. Use a test account.</p>
      <Field label="Webhook" hint="optional; Slack incoming-webhook URLs get a formatted message">
        <input name="webhookUrl" type="url" defaultValue={project?.webhookUrl ?? ""} placeholder="https://hooks.slack.com/services/…" className={input} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" loading={saving}>
          Save project
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
