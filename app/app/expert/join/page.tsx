import { ExpertJoinForm } from "@/components/expert-join-form";

export default async function ExpertJoin({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  return <main className="narrow expert-join-page"><ExpertJoinForm invite={invite ?? ""} /></main>;
}
