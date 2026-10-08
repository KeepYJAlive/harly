# TAO Remote Lists

Harly manages vocabulary definitions and stable vocabulary identifiers. TAO owns
metadata properties, item metadata assignments, competencies, scoring, sections,
and assessment results. There are no Harly item-metadata assignment tables or
APIs in this feature.

```text
TAO's existing RemoteSource → HTTPS GET → Harly TypeScript Remote List endpoint
```

No PHP adapter, TAO extension, or TAO source change is required. Harly makes no
outbound request to TAO for this feature. List management, startup, migrations,
and serving work with TAO stopped and without TAO database credentials, a TAO
URL, or an enabled LTI connection. The source URL points to Harly; it is not a
TAO connection setting.

## Installed contract inspected

Source inspected in the running local #KeepYJAlive container `tao-ce-tao-1`
(image `keepyjalive/tao-ce:dev`) on October 7, 2026. These are the verified local
installation versions, not a claim about a separate production deployment:

| Composer package                  | Version    | Source reference                           |
| --------------------------------- | ---------- | ------------------------------------------ |
| `oat-sa/tao-core`                 | `v54.42.4` | `3246ae201a8f845b73e7cd7e848dfada4eff6eb2` |
| `oat-sa/extension-tao-backoffice` | `v7.1.0`   | `19571e25f5f68c09ffe796d3ae6960cab2810edb` |
| `oat-sa/generis`                  | `v16.1.2`  | `1ce4083eab81070288752ac99b7d964cbe45a3a2` |
| `guzzlehttp/guzzle`               | `7.8.2`    | `f4152d9eb85c445fe1f992001d1748e8bec070d2` |

Files below are relative to `/opt/tao-ce/construct/backend/` inside that container.

| Source                                                                                           | Observed behavior                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tao/models/classes/Lists/Business/Service/RemoteSource.php`, `fetchByContext()`                 | Calls `$client->get($sourceUrl)` with no per-request options. Decodes the entire body with `json_decode(..., true)` and invokes the configured parser.                                                 |
| `config/tao/RemoteSource.conf.php`                                                               | Registers JSONPath and scale parsers; client is `null`, so `RemoteSource` creates a default Guzzle client.                                                                                             |
| `tao/models/classes/Lists/Business/Domain/RemoteSourceContext.php`                               | Accepts source URL, URI path, label path, optional dependency URI path, parser name, and decoded JSON. Decoded JSON must be an array.                                                                  |
| `tao/models/classes/Lists/Business/Service/RemoteSourceJsonPathParser.php`, `iterateByContext()` | Selects URI and label arrays by JSONPath. Unequal counts throw; zero URIs yield no values. Pairs by position into `Value(null, uri, label, dependencyUri)`.                                            |
| `tao/models/classes/Lists/Business/Domain/Value.php`                                             | Value constructor requires string URI and label; dependency URI is optional. No enabled/disabled field.                                                                                                |
| `taoBackOffice/model/lists/RemoteListService.php`                                                | Reads the stored source URL and paths, selects `jsonpath`, materializes the entire response, and persists it through TAO's `ValueCollectionService`.                                                   |
| `tao/actions/form/class.RemoteList.php`                                                          | Remote List UI exposes Name, Data source URI, URI Path, Label Path, and optionally Dependency URI Path. No custom-header field.                                                                        |
| `taoBackOffice/controller/Lists.php`, `remote()` / `reloadRemoteList()`                          | Creation cleans up a failed new list. Reload catches exceptions and reports failure.                                                                                                                   |
| `tao/models/classes/Lists/DataAccess/Repository/RdsValueCollectionRepository.php`, `persist()`   | Replaces cached list values in a transaction. Omission during a successful sync removes a cached URI.                                                                                                  |
| `vendor/guzzlehttp/guzzle/src/Client.php`                                                        | HTTP errors enabled, TLS verification enabled, no custom timeout configured.                                                                                                                           |
| `vendor/guzzlehttp/guzzle/src/RedirectMiddleware.php`                                            | Defaults to at most five redirects.                                                                                                                                                                    |
| `vendor/guzzlehttp/guzzle/src/Handler/CurlFactory.php`                                           | Passes the URL, including any userinfo, to cURL. Default connection timeout is 300 seconds; overall timeout is set only if supplied. cURL is installed and selected for ordinary synchronous requests. |

**HTTP contract:** one GET of the complete configured source URL. TAO adds no
query parameters, pagination parameters, search text, filters, or request body.
There is no fixed endpoint path, fixed response envelope, identifier field name,
label field name, or remote total/count field. TAO uses the configured JSONPaths.
It does not retrieve subsequent pages.

The optional dependency JSONPath is read only when
`FEATURE_FLAG_LISTS_DEPENDENCY_ENABLED` is enabled. It supplies one dependency URI
per selected value, not a recursive tree. Harly currently serves independent flat
vocabularies; leave that path empty. No feature flag change is needed.

HTTP 4xx/5xx and transport failures throw before persistence. Malformed JSON fails
context validation. JSONPath errors and mismatched URI/label counts throw. An empty
URI selection is a valid empty collection, which is why Harly returns errors, not
`200` with an empty list, for disabled/missing/unavailable vocabularies.

TAO specifies no request timeout. In the inspected cURL transport, the connection
limit defaults to 300 seconds with no explicit total transfer limit. PHP, proxies,
or other deployment infrastructure can impose additional limits. Harly cannot
configure TAO's timeout through its response.

## Harly configuration and importing

1. Apply migration `0164_tired_thunderbolt_ross` using the normal verified migration
   workflow. Configure Harly's existing `AI_ENCRYPTION_KEY` secret storage.
2. Open **Settings → Integrations → TAO → Remote Lists**.
3. Create a list with a stable key and name, or import JSON. New lists start disabled.
4. Review additions, label/status changes, unchanged entries, and entries removed
   from the import. Commit the reviewed preview. Preview receipts expire after
   15 minutes, are bound to the administrator/workspace/input, and reject stale
   revisions. The same preview path is used for manual entry edits.
5. Enable the list, then generate a read token. A TAO/LTI connection is not required.
6. Use **TAO connection → Copy source URL** for each list.

Example normalized import (keys are unique within a Harly workspace; entry IDs
are unique within a list):

```json
{
  "key": "kyja_topics",
  "name": "KYJA Topics",
  "values": [
    { "id": "canon_ambiguity", "label": "Canon Ambiguity" },
    { "id": "character_death", "label": "Character Death" },
    { "id": "grief", "label": "Grief" },
    { "id": "wally_fate", "label": "Wally’s Fate" }
  ]
}
```

Optional `description` and entry `enabled` fields round-trip through exports.
Imports accept at most 500 KB and lists at most 10,000 entries. IDs must be nonempty,
without surrounding whitespace/control characters, and their resulting encoded URIs
must fit TAO’s 255-character URI column (`tao/scripts/install/CreateRdsListStore.php`). Labels must be nonempty and
unique after whitespace trimming, Unicode NFKC normalization and lowercasing.
Unknown fields and malformed JSON are rejected. Stable list keys cannot be renamed.
Existing entry IDs cannot be edited in the form; imports match existing entries by
ID and update their labels without replacing database identities.

Omitted entries are **retained**, never deleted or implicitly disabled. Duplicate
labels are checked against retained entries too. All entry updates lock the parent
list and advance its revision. Concurrent changes require a new preview.

**Deletion policy:** only empty lists can be deleted. Nonempty lists can be disabled,
which stops synchronization with an HTTP error and leaves TAO's cached vocabulary
intact. Harly cannot prove a value is unused because usage belongs to TAO. There is
no force-delete operation. An entry's `enabled: false` status is preserved in Harly
and exports, but the URI remains in the served vocabulary: the installed TAO parser
has no status field, and omitting it would remove cached values. Manage selection
policy in TAO.

## Configure TAO using its existing UI

For a Harly list, enter:

| TAO field           | Value                                                                                                                |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Name                | Your vocabulary display name                                                                                         |
| Data source URI     | Copied HTTPS URL, shaped as `https://WORKSPACE_ID:READ_TOKEN@harly.example/api/plugins/tao/remote-lists/kyja_topics` |
| URI Path            | `$.values[*].uri`                                                                                                    |
| Label Path          | `$.values[*].label`                                                                                                  |
| Dependency URI Path | Leave empty                                                                                                          |

The installed Guzzle/cURL transport supports HTTP Basic credentials in the source
URL. Harly authenticates the workspace ID as username and the generated read token
as password. No additional headers, query parameters, PHP, or service configuration
are needed. The generated URL requires an HTTPS public Harly origin (`HARLY_URL`).
Use the final Harly hostname, avoiding redirects.

The endpoint returns the entire vocabulary in deterministic position order:

```json
{
  "values": [
    {
      "uri": "urn:harly:remote-list:70e6c733-3a68-4a3c-83b8-f6940b799d25:grief",
      "label": "Grief"
    }
  ]
}
```

The URI is derived from the immutable Harly list UUID and URL-encoded external key,
not the label, server hostname, or list name. This prevents collisions between
independent lists and workspaces. Renaming a label preserves its URI. Back up and
restore Harly's database to preserve list UUIDs; creating a new list from exported
JSON creates a new vocabulary identity.

The field names in this response are Harly's mapping through TAO's existing
JSONPath mechanism, not a claim that TAO defines a fixed REST schema. Configure
the metadata property and item assignments in TAO. Harly makes no assignment
decisions. Reload the remote list in TAO after vocabulary changes; the inspected
client does not poll Harly automatically.

## Access and secrets

- Read endpoint: HTTP Basic only, scoped to one workspace, with constant-time
  token comparison. No staff session is required. Invalid credentials return
  `401` with a Basic challenge; unknown lists return `404`; a disabled list returns `409`. All responses use `Cache-Control: no-store`.
- Administrative operations: Harly server actions require a logged-in actor with
  `integrations:manage`, enforce workspace scope and demo locks, and audit changes.
  Read credentials cannot invoke them. The HTTP read route has no mutation handlers.
- The read token uses Harly's existing AES-GCM encrypted workspace configuration.
  Connection URLs are disclosed only by an explicit administrator action, not
  embedded in the initial page or JSON exports.
- TAO necessarily stores the credential-bearing Data source URI in its existing
  Remote List configuration. Treat that field, TAO backups, and copied URLs as
  secrets. Keep access restricted to trusted TAO administrators; avoid logging
  Authorization headers. Credentials are not query parameters or request paths.
- Rotating a token immediately revokes old URLs. Update the configured source URL
  on every affected TAO list before reloading; cached TAO values remain intact if
  authentication fails.

## Verification

Focused TypeScript tests:

```sh
pnpm --filter web test -- src/lib/tao/remote-lists \
  'src/app/api/plugins/tao/remote-lists/[key]/route.test.ts' \
  src/proxy.remote-lists.test.ts
pnpm --filter web typecheck
```

Real PostgreSQL tests (stable database identity on rename, retained omissions,
workspace isolation, concurrent commits, deletion guards, authentication and token
rotation) run in a fresh disposable database. Supply a local PostgreSQL connection
with database-creation privileges via `HARLY_REMOTE_LIST_TEST_ADMIN_URL`, then run:

```sh
node tooling/scripts/test-tao-remote-lists.mjs
```

The runner builds and executes Harly's actual migration runtime with only Harly's
database configuration (and deliberately invalid unrelated URLs), applies the
complete migration chain, verifies its journal/hashes,
runs integration tests, and removes its temporary database in a `finally` block.
It refuses a non-local database host and never migrates the supplied existing DB.

## Migration configuration and Compose troubleshooting

`harly migrate` reads only `DATABASE_URL`, optional `HARLY_VERSION`, and optional
`HARLY_MIGRATIONS_DIR`. It does not load web/public-origin, storage, OAuth, Remote
List, or TAO connection configuration. The Harly Compose migration service passes
only `DATABASE_URL`, `HARLY_VERSION`, and `NODE_ENV`.

Use a complete, URL-encoded Harly PostgreSQL connection string in `.env`.
`DATABASE_URL='postgresql://${POSTGRES_USER}:…@${POSTGRES_HOST}:…/…'` stays literal
because Compose does not expand single-quoted values; Node's `dotenv` also does
not perform expansion. This previously caused `runtime.fatal: Invalid URL`.
Unexpanded placeholders now produce a specific `DATABASE_URL` error without
printing credentials. The local `.env` has been resolved using Harly's existing
`POSTGRES_*` values.

Harly's Compose files do not reference `TAO_PG_PASSWORD`. That reference belongs
to the separate `tao-ce/docker-compose.yml` database configuration (the `pgsql`
backend). Compose interpolates that project file when it is selected, even for
read-only commands such as `config`. It was not introduced by Remote Lists and
must not be removed from TAO for this feature. Run Harly Compose commands from
Harly's directory or select Harly's `compose.yaml` explicitly; do not merge in
TAO's Compose files.
