import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { rpc } from "./api";
import { useAuth } from "../auth/AuthProvider";
import { useSignInPrompt } from "../components/AuthPrompt";

/** Saved providers. Visitors are asked to sign in the moment they tap the heart. */
export function useLikes() {
  const { session } = useAuth();
  const qc = useQueryClient();
  const prompt = useSignInPrompt();
  const q = useQuery({ queryKey: ["my-likes", session?.user.id], enabled: !!session, queryFn: () => rpc<string[]>("my_likes") });
  const liked = new Set(q.data ?? []);
  const toggle = useCallback(async (providerId: string, name = "this provider") => {
    if (!session) return prompt({ title: "Save providers you like", body: `Create a free account to save ${name} and find them again in one tap.` });
    const now = await rpc<boolean>("toggle_like", { p_provider: providerId });
    qc.setQueryData<string[]>(["my-likes", session.user.id], (old = []) => now ? [...old, providerId] : old.filter((x) => x !== providerId));
    qc.invalidateQueries({ queryKey: ["market"] }); qc.invalidateQueries({ queryKey: ["public-provider"] });
  }, [session, prompt, qc]);
  return { liked, toggle };
}
