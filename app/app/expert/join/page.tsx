import Link from "next/link";

export default async function ExpertJoin({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  return <main><p className="eyebrow">Invite-only expert review</p><h1>Join the review panel.</h1><p>Use the invited email address. Your reviews are submitted independently and remain hidden from other reviewers until you submit.</p><Link className="button-link" href={`/?invite=${encodeURIComponent(invite ?? "")}`}>Create expert profile</Link></main>;
}
