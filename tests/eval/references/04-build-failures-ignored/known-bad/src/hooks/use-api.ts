// Deliberately broken: imports from wrong path
import { fetchData } from "@/lib/api-clients"; // typo: should be api-client

export function useApi(url: string) {
  return fetchData(url);
}
