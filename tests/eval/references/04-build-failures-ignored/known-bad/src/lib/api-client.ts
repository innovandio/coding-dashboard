// Deliberately broken: uses `any`, missing types, wrong imports

import { NonExistentModule } from "./does-not-exist";

export async function fetchData(url: string): Promise<any> {
  const response = await fetch(url);
  const data: any = await response.json();
  return data;
}

export function getUsers() {
  return fetchData("/api/users");
}
