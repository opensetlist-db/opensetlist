import { useTranslations } from "next-intl";

export default function HomePage() {
  const t = useTranslations("Home");

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-4">
      <h1 className="text-4xl font-bold tracking-tight">{t("title")}</h1>
      <p className="mt-4 text-lg text-zinc-500">{t("description")}</p>
    </main>
  );
}
