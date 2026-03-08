// @ts-nocheck
import { browser } from 'fumadocs-mdx/runtime/browser';
import type * as Config from '../source.config';

const create = browser<typeof Config, import("fumadocs-mdx/runtime/types").InternalTypeConfig & {
  DocData: {
  }
}>();
const browserCollections = {
  docs: create.doc("docs", {"concepts.mdx": () => import("../content/docs/concepts.mdx?collection=docs"), "dashboard.mdx": () => import("../content/docs/dashboard.mdx?collection=docs"), "index.mdx": () => import("../content/docs/index.mdx?collection=docs"), "mcp-server.mdx": () => import("../content/docs/mcp-server.mdx?collection=docs"), "getting-started/create-account.mdx": () => import("../content/docs/getting-started/create-account.mdx?collection=docs"), "getting-started/first-request.mdx": () => import("../content/docs/getting-started/first-request.mdx?collection=docs"), "sdks/no-sdk.mdx": () => import("../content/docs/sdks/no-sdk.mdx?collection=docs"), "sdks/node.mdx": () => import("../content/docs/sdks/node.mdx?collection=docs"), "sdks/python.mdx": () => import("../content/docs/sdks/python.mdx?collection=docs"), }),
};
export default browserCollections;