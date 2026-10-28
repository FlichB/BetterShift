"use client";

// [fork] Jahresausgleich (SPEC 12.41): Delta tables and overrides of a rotation.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RotationApiError } from "@/hooks/useRotations";
import { rotationQueryKeys } from "@/lib/rotation/query-keys";
import type { YearDeltaTable } from "@/lib/rotation/yearly";

export interface YearDeltaChange {
  year: number;
  userId: string;
  delta: number | null;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new RotationApiError(typeof data.error === "string" ? data.error : "internal", response.status);
  return data as T;
}

export function useYearDeltas(rotationId: string) {
  return useQuery({
    queryKey: rotationQueryKeys.yearDeltas(rotationId),
    queryFn: () => request<YearDeltaTable[]>(`/api/rotations/${rotationId}/year-deltas`),
  });
}

export function useSetYearDelta(rotationId: string) {
  const queryClient = useQueryClient();
  const key = rotationQueryKeys.yearDeltas(rotationId);
  return useMutation<YearDeltaTable[], RotationApiError, YearDeltaChange, { previous?: YearDeltaTable[] }>({
    mutationFn: (change) => request(`/api/rotations/${rotationId}/year-deltas`, { method: "PUT", body: JSON.stringify(change) }),
    onMutate: async (change) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<YearDeltaTable[]>(key);
      if (previous) {
        queryClient.setQueryData<YearDeltaTable[]>(
          key,
          previous.map((table) =>
            table.year !== change.year
              ? table
              : {
                  ...table,
                  rows: table.rows.map((row) =>
                    row.userId !== change.userId ? row : { ...row, override: change.delta, delta: change.delta ?? row.autoDelta }
                  ),
                }
          )
        );
      }
      return { previous };
    },
    onError: (_error, _change, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}
