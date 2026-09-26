"use server";
import { requireUser } from "@/server/auth";
import { globalSearch, type SearchHit } from "@/server/services/search";

export async function searchAction(q: string): Promise<SearchHit[]> {
  await requireUser();
  if (typeof q !== "string") return [];
  return globalSearch(q);
}
