// @ts-nocheck
import { default as __fd_glob_11 } from "../content/docs/sdks/meta.json?collection=meta"
import { default as __fd_glob_10 } from "../content/docs/getting-started/meta.json?collection=meta"
import { default as __fd_glob_9 } from "../content/docs/meta.json?collection=meta"
import * as __fd_glob_8 from "../content/docs/sdks/python.mdx?collection=docs"
import * as __fd_glob_7 from "../content/docs/sdks/node.mdx?collection=docs"
import * as __fd_glob_6 from "../content/docs/sdks/no-sdk.mdx?collection=docs"
import * as __fd_glob_5 from "../content/docs/getting-started/first-request.mdx?collection=docs"
import * as __fd_glob_4 from "../content/docs/getting-started/create-account.mdx?collection=docs"
import * as __fd_glob_3 from "../content/docs/mcp-server.mdx?collection=docs"
import * as __fd_glob_2 from "../content/docs/index.mdx?collection=docs"
import * as __fd_glob_1 from "../content/docs/dashboard.mdx?collection=docs"
import * as __fd_glob_0 from "../content/docs/concepts.mdx?collection=docs"
import { server } from 'fumadocs-mdx/runtime/server';
import type * as Config from '../source.config';

const create = server<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>({"doc":{"passthroughs":["extractedReferences"]}});

export const docs = await create.doc("docs", "content/docs", {"concepts.mdx": __fd_glob_0, "dashboard.mdx": __fd_glob_1, "index.mdx": __fd_glob_2, "mcp-server.mdx": __fd_glob_3, "getting-started/create-account.mdx": __fd_glob_4, "getting-started/first-request.mdx": __fd_glob_5, "sdks/no-sdk.mdx": __fd_glob_6, "sdks/node.mdx": __fd_glob_7, "sdks/python.mdx": __fd_glob_8, });

export const meta = await create.meta("meta", "content/docs", {"meta.json": __fd_glob_9, "getting-started/meta.json": __fd_glob_10, "sdks/meta.json": __fd_glob_11, });