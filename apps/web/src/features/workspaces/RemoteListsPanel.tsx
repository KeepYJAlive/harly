"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { RemoteListView } from "@/lib/tao/remote-lists/data";
import type { Vocabulary } from "@/lib/tao/remote-lists/import";
import {
  previewRemoteListAction,
  commitRemoteListAction,
  changeRemoteListAction,
  rotateRemoteListTokenAction,
  getRemoteListConnectionAction,
} from "./remote-list-actions";

type Preview = Extract<
  Awaited<ReturnType<typeof previewRemoteListAction>>,
  { ok: true }
>;
const empty = (): Vocabulary => ({
  key: "",
  name: "",
  description: "",
  values: [],
});
export function RemoteListsPanel({
  lists,
  canEdit,
  workspaceId,
}: {
  lists: RemoteListView[];
  canEdit: boolean;
  workspaceId: string;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [editor, setEditor] = useState<Vocabulary | null>(null);
  const [target, setTarget] = useState<{
    id: string | null;
    revision: number | null;
  }>({ id: null, revision: null });
  const [json, setJson] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState("");
  const [connection, setConnection] = useState("");
  const [mode, setMode] = useState<"form" | "json">("form");
  function run(work: () => Promise<void>) {
    setMessage("");
    start(async () => {
      try {
        await work();
      } catch {
        setMessage("The request failed. Refresh and try again.");
      }
    });
  }
  function open(list?: RemoteListView, importJson = false) {
    const value = list
      ? {
          key: list.key,
          name: list.name,
          description: list.description,
          values: list.values,
        }
      : empty();
    setEditor(value);
    setJson(JSON.stringify(value, null, 2));
    setPreview(null);
    setMessage("");
    setTarget({ id: list?.id ?? null, revision: list?.revision ?? null });
    setMode(importJson ? "json" : "form");
  }
  function update(value: Vocabulary) {
    setEditor(value);
    setJson(JSON.stringify(value, null, 2));
    setPreview(null);
  }
  function exportList(list: RemoteListView) {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            key: list.key,
            name: list.name,
            description: list.description,
            values: list.values,
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${list.key}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section
      className="space-y-4 rounded-xl border p-6"
      aria-label="Remote Lists"
    >
      <h2 className="text-xl font-semibold">Remote Lists</h2>
      <p className="text-sm text-muted-foreground">
        Manage vocabulary here. TAO owns metadata properties, item assignments,
        competencies, scoring, sections, and results. Enable a list when it is
        ready to synchronize.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button disabled={!canEdit || busy} onClick={() => open()}>
          Create
        </Button>
        <Button
          variant="outline"
          disabled={!canEdit || busy}
          onClick={() => open(undefined, true)}
        >
          Import JSON
        </Button>
        <Button
          variant="outline"
          disabled={!canEdit || busy}
          onClick={() => {
            if (
              !window.confirm(
                "Generate a new read token? Any previous token will stop working immediately.",
              )
            )
              return;
            run(async () => {
              const result = await rotateRemoteListTokenAction();
              if (!result.ok) setMessage(result.error);
              else {
                setConnection("");
                setMessage(
                  "Read token rotated. Copy a new TAO source URL for each configured list.",
                );
              }
            });
          }}
        >
          Generate / rotate read token
        </Button>
      </div>
      <p className="text-sm">
        Workspace: <code>{workspaceId}</code>. Use “TAO connection” to copy the
        authenticated source URL into TAO’s Remote List configuration.
      </p>
      {connection && (
        <div className="space-y-2 rounded border p-3">
          <p>
            The source URL contains read credentials. Store it only in TAO’s
            Data source URI field. Rotating the read token requires updating
            every configured list URL.
          </p>
          <label className="block">
            Data source URI
            <Input
              aria-label="TAO data source URI"
              type="password"
              readOnly
              value={connection}
            />
          </label>
          <p>
            URI Path: <code>$.values[*].uri</code>
          </p>
          <p>
            Label Path: <code>$.values[*].label</code>
          </p>
          <p>Leave Dependency URI Path empty.</p>
          <Button
            variant="outline"
            onClick={() =>
              run(async () => {
                await navigator.clipboard.writeText(connection);
                setMessage("TAO source URL copied.");
              })
            }
          >
            Copy source URL
          </Button>
          <Button variant="ghost" onClick={() => setConnection("")}>
            Hide
          </Button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              {[
                "Name",
                "Key",
                "Entries",
                "Status",
                "Last updated",
                "Actions",
              ].map((label) => (
                <th className="p-2" key={label}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lists.map((list) => (
              <tr key={list.id} className="border-t">
                <td className="p-2">{list.name}</td>
                <td className="p-2">
                  <code>{list.key}</code>
                </td>
                <td className="p-2">{list.values.length}</td>
                <td className="p-2">{list.enabled ? "Enabled" : "Disabled"}</td>
                <td className="p-2">
                  {new Date(list.updatedAt).toLocaleString()}
                </td>
                <td className="flex flex-wrap gap-1 p-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canEdit || busy}
                    onClick={() =>
                      run(async () => {
                        const result = await getRemoteListConnectionAction(
                          list.id,
                        );
                        if (!result.ok) setMessage(result.error);
                        else setConnection(result.sourceUrl);
                      })
                    }
                  >
                    TAO connection
                  </Button>

                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => open(list)}
                  >
                    View/Edit entries
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canEdit || busy}
                    onClick={() => open(list, true)}
                  >
                    Import JSON
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => exportList(list)}
                  >
                    Export JSON
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canEdit || busy}
                    onClick={() =>
                      run(async () => {
                        const result = await changeRemoteListAction({
                          id: list.id,
                          revision: list.revision,
                          action: list.enabled ? "disable" : "enable",
                        });
                        if (!result.ok) setMessage(result.error);
                        else router.refresh();
                      })
                    }
                  >
                    {list.enabled ? "Disable" : "Enable"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canEdit || busy}
                    onClick={() => {
                      if (
                        !window.confirm(
                          `Delete ${list.name}? Only empty lists can be deleted because TAO owns usage information.`,
                        )
                      )
                        return;
                      run(async () => {
                        const result = await changeRemoteListAction({
                          id: list.id,
                          revision: list.revision,
                          action: "delete",
                        });
                        if (!result.ok) setMessage(result.error);
                        else {
                          if (target.id === list.id) setEditor(null);
                          router.refresh();
                        }
                      });
                    }}
                  >
                    Delete
                  </Button>
                </td>
              </tr>
            ))}
            {!lists.length && (
              <tr>
                <td className="p-2" colSpan={6}>
                  No remote lists yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {editor && (
        <div className="space-y-4 border-t pt-4">
          <h3 className="font-semibold">
            {target.id ? `Edit ${editor.key}` : "Create remote list"}
          </h3>
          {mode === "json" ? (
            <>
              <label className="block">
                JSON file
                <Input
                  type="file"
                  accept=".json,application/json"
                  disabled={!canEdit || busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    if (file.size > 500_000) {
                      setMessage("JSON must be at most 500 KB.");
                      return;
                    }
                    run(async () => {
                      setJson(await file.text());
                      setPreview(null);
                    });
                  }}
                />
              </label>
              <label className="block">
                Import JSON
                <Textarea
                  className="min-h-64 font-mono"
                  value={json}
                  disabled={!canEdit || busy}
                  onChange={(event) => {
                    setJson(event.target.value);
                    setPreview(null);
                  }}
                />
              </label>
            </>
          ) : (
            <fieldset disabled={!canEdit || busy} className="space-y-3">
              <label className="block">
                Stable key
                <Input
                  value={editor.key}
                  disabled={!!target.id}
                  onChange={(e) => update({ ...editor, key: e.target.value })}
                />
              </label>
              <label className="block">
                Display name
                <Input
                  value={editor.name}
                  onChange={(e) => update({ ...editor, name: e.target.value })}
                />
              </label>
              <label className="block">
                Description
                <Textarea
                  value={editor.description}
                  onChange={(e) =>
                    update({ ...editor, description: e.target.value })
                  }
                />
              </label>
              {editor.values.map((entry, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-2">
                  <label>
                    Stable ID
                    <Input
                      value={entry.id}
                      disabled={
                        !!lists
                          .find((l) => l.id === target.id)
                          ?.values.some((v) => v.id === entry.id)
                      }
                      onChange={(e) =>
                        update({
                          ...editor,
                          values: editor.values.map((v, j) =>
                            j === i ? { ...v, id: e.target.value } : v,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Label
                    <Input
                      value={entry.label}
                      onChange={(e) =>
                        update({
                          ...editor,
                          values: editor.values.map((v, j) =>
                            j === i ? { ...v, label: e.target.value } : v,
                          ),
                        })
                      }
                    />
                  </label>
                </div>
              ))}
              <Button
                variant="outline"
                onClick={() =>
                  update({
                    ...editor,
                    values: [
                      ...editor.values,
                      { id: "", label: "", enabled: true },
                    ],
                  })
                }
              >
                Add value
              </Button>
            </fieldset>
          )}
          <p className="text-sm text-muted-foreground">
            Existing IDs are permanent. Omitted entries are retained. Disabled
            entries remain in TAO synchronization to preserve references; manage
            their use in TAO.
          </p>
          <div className="flex gap-2">
            <Button
              disabled={!canEdit || busy}
              onClick={() =>
                run(async () => {
                  const result = await previewRemoteListAction(json, target);
                  if (!result.ok) {
                    setMessage(result.error);
                    setPreview(null);
                  } else setPreview(result);
                })
              }
            >
              Validate & preview
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setEditor(null);
                setPreview(null);
              }}
            >
              Close
            </Button>
          </div>
          {preview && (
            <div className="space-y-3 rounded border p-4">
              <h4 className="font-semibold">Import preview</h4>
              {(
                [
                  [
                    "Additions",
                    preview.diff.additions.map((v) => `${v.id}: ${v.label}`),
                  ],
                  [
                    "Label / status changes",
                    preview.diff.changes.map(
                      (v) =>
                        `${v.after.id}: ${v.before.label} → ${v.after.label}${v.before.enabled !== v.after.enabled ? ` (enabled: ${v.before.enabled} → ${v.after.enabled})` : ""}`,
                    ),
                  ],
                  [
                    "Unchanged entries",
                    preview.diff.unchanged.map((v) => `${v.id}: ${v.label}`),
                  ],
                  [
                    "Removed from import — retained in Harly",
                    preview.diff.removed.map((v) => `${v.id}: ${v.label}`),
                  ],
                ] as [string, string[]][]
              ).map(([heading, values]) => (
                <details key={heading} open={heading !== "Unchanged entries"}>
                  <summary>
                    {heading} ({values.length})
                  </summary>
                  <ul className="max-h-60 overflow-auto pl-4">
                    {values.map((value) => (
                      <li key={value}>{value}</li>
                    ))}
                  </ul>
                </details>
              ))}
              <Button
                disabled={!canEdit || busy}
                onClick={() =>
                  run(async () => {
                    const result = await commitRemoteListAction(
                      json,
                      target,
                      preview.receipt,
                    );
                    if (!result.ok) setMessage(result.error);
                    else {
                      setEditor(null);
                      setPreview(null);
                      setMessage("Vocabulary saved.");
                      router.refresh();
                    }
                  })
                }
              >
                Commit reviewed import
              </Button>
            </div>
          )}
        </div>
      )}
      {message && (
        <p role="status" className="whitespace-pre-wrap text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
