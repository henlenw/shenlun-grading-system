import Console from '../../../components/Console';
export default async function Page({ params }: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await params;
  return <Console section={path[0] || 'dashboard'} id={path[1]} />;
}
