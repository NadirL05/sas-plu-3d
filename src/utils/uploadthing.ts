import { generateReactHelpers } from "@uploadthing/react";
import type { OurFileRouter } from "@/app/api/uploadthing/core";

const utHelpers = generateReactHelpers<OurFileRouter>();

export const uploadFiles = <TEndpoint extends keyof OurFileRouter>(opts: {
  endpoint: TEndpoint;
  files: File[];
}) => utHelpers.uploadFiles(opts.endpoint, { files: opts.files });

export const { useUploadThing, getRouteConfig, createUpload, routeRegistry } = utHelpers;
