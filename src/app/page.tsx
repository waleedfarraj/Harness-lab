import { loadDiagnosisForDemo } from "@/lib/demo/load-diagnosis";
import { DiagnosisPage } from "@/components/diagnosis/DiagnosisPage";

export default async function Page({ searchParams }: { searchParams: Promise<{ evidence?: string }> }) {
  const { evidence } = await searchParams;
  const loaded = loadDiagnosisForDemo(evidence);
  return <DiagnosisPage {...loaded} />;
}
