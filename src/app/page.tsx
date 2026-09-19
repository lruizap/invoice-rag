import ExtractoApp from "@/components/ExtractoApp";

export default function Home() {
  return (
    <main className="flex-1 flex flex-col items-center gap-10 px-4 py-16">
      <div className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Extracto</h1>
        <p className="mt-2 opacity-60">
          Sube una imagen o un PDF, revisa los datos extraídos y guárdalos.
        </p>
      </div>
      <ExtractoApp />
    </main>
  );
}
