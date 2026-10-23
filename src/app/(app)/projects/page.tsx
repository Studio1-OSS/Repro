import type { Metadata } from "next";
import { features } from "@/env";
import { ProjectsManager } from "@/components/fix/projects-manager";
import { requireUser } from "@/server/auth";
import { listProjects, publicProject } from "@/server/services/projects";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage({ searchParams }: { searchParams: Promise<{ origin?: string }> }) {
  const user = await requireUser("/projects");
  const projects = (await listProjects(user.id)).map(publicProject);
  const { origin } = await searchParams;
  return (
    <div className="container-page max-w-4xl py-10">
      <p className="eyebrow">Fix it</p>
      <h1 className="mt-1 text-heading font-semibold">Projects</h1>
      <p className="mt-3 max-w-2xl text-ink-2">
        A project tells Repro where a site&apos;s code lives, so the AI can propose fixes for its reports, check them in a sandbox, and apply them or open a pull request. Reports are matched to a project by the page&apos;s origin.
      </p>
      <ProjectsManager
        initial={projects.map((p) => ({ ...p, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() }))}
        selfHosted={features.selfHosted}
        prefillOrigin={origin}
      />
    </div>
  );
}
