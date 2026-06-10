import { UserRole } from "@prisma/client";

import { color } from "../terminal/ui";

export const ROLE_OPTIONS: Array<{ key: string; role: UserRole; label: string; description: string }> = [
  { key: "1", role: "BUYER", label: "Pembeli", description: "Cari barang titipan dan checkout." },
  { key: "2", role: "SELLER", label: "Penjual", description: "Buka listing dan atur stok." },
  { key: "3", role: "COURIER", label: "Kurir", description: "Ambil order dan antar barang." },
];

export function formatRole(role: UserRole) {
  switch (role) {
    case "BUYER":
      return "Pembeli";
    case "SELLER":
      return "Penjual";
    case "COURIER":
      return "Kurir";
  }
}

export function roleMenuTone(role: UserRole) {
  if (role === "SELLER") {
    return "pink" as const;
  }

  if (role === "BUYER") {
    return "cyan" as const;
  }

  return "yellow" as const;
}

export function roleSummaryHint(role: UserRole) {
  switch (role) {
    case "BUYER":
      return color("Mode pembeli siap untuk fitur checkout berikutnya.", "muted");
    case "SELLER":
      return color("Mode penjual siap untuk fitur manajemen listing.", "muted");
    case "COURIER":
      return color("Mode kurir siap untuk fitur pengantaran.", "muted");
  }
}
