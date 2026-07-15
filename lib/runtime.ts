export function isNetlifyRuntime() {
  return process.env.NETLIFY === "true"
    || Boolean(process.env.NETLIFY_BLOBS_CONTEXT)
    || Boolean(process.env.DEPLOY_ID)
    || typeof globalThis.netlifyBlobsContext === "string";
}
