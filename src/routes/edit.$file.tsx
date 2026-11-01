import { createFileRoute, Link } from '@tanstack/react-router'
import { readFile } from '~/lib/files'
import { Editor } from '~/components/Editor'

export const Route = createFileRoute('/edit/$file')({
  loader: ({ params }) => readFile({ data: { name: params.file } }),
  component: EditPage,
  errorComponent: ({ error }) => (
    <main className="mx-auto max-w-xl px-6 py-10">
      <h1 className="text-lg font-semibold">Could not open file</h1>
      <pre className="mt-3 whitespace-pre-wrap rounded-md bg-red-50 p-3 text-sm text-red-700">
        {error instanceof Error ? error.message : String(error)}
      </pre>
      <Link to="/" className="btn mt-4">Back to files</Link>
    </main>
  ),
})

function EditPage() {
  const { name, text } = Route.useLoaderData()
  return <Editor key={name} fileName={name} initialText={text} />
}
