import { generateReactHelpers } from "@uploadthing/react";
import type { OurFileRouter } from "@/app/api/uploadthing/core";

const utHelpers = generateReactHelpers<OurFileRouter>();

type UploadResult = { url?: string; ufsUrl?: string };

const uploadFilesInternal = utHelpers.uploadFiles as unknown as (
  endpoint: keyof OurFileRouter,
  options: { files: File[] }
) => Promise<UploadResult[]>;

export const uploadFiles = <TEndpoint extends keyof OurFileRouter>(opts: {
  endpoint: TEndpoint;
  files: File[];
}) => uploadFilesInternal(opts.endpoint, { files: opts.files });

export const { useUploadThing, getRouteConfig, createUpload, routeRegistry } = utHelpers;

