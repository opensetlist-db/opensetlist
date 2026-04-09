export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // html/body are rendered by the [locale] layout so the lang attribute is set correctly
  return children;
}
