import { getStudioDb, schema } from "@/lib/studio/db";

import { TemplateEditor } from "@/components/studio/template-editor";

export default async function StudioTemplatesPage() {
  const db = getStudioDb();
  const templates = await db.select().from(schema.studioTemplates);
  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-semibold text-2xl tracking-tight">Шаблоны дизайнов</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-400">
          Для каждого дизайна (speed / life / rainy) задаются пути к файлам относительно{" "}
          <code className="text-zinc-300">data/studio/</code>: макет принта, 2–3 референса стиля
          собаки, один референс стиля текста. Положи свои PNG/JPEG в папку, например{" "}
          <code className="text-zinc-300">data/studio/templates/speed/</code>, затем пропиши пути
          ниже и нажми «Сохранить». Превью открываются по ссылкам, если файл на месте.
        </p>
      </div>
      <div className="space-y-10">
        {templates.map((t) => (
          <TemplateEditor key={t.slug} template={t} />
        ))}
      </div>
    </div>
  );
}
