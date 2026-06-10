import { box, color, hero, menuOption, printScreen } from "../../shared/terminal/ui";

export async function renderHomeMenu() {
  printScreen([
    hero(),
    box(
      [
        color("Tiga role utama tersedia: pembeli, penjual, dan kurir.", "bold"),
        "",
        menuOption("1", "Register", "Buat akun baru dan pilih role.", "pink"),
        menuOption("2", "Login", "Masuk ke dashboard sesuai role.", "cyan"),
        menuOption("3", "Quit", "Keluar dari aplikasi terminal.", "yellow"),
      ],
      { title: "MAIN MENU", tone: "cyan" },
    ),
  ]);
}
