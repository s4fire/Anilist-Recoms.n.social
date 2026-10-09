import { Link, useParams } from 'react-router-dom'

const pages = {
  terms: { title: 'Terms', eyebrow: 'A PLAIN-LANGUAGE DRAFT', sections: [
    ['Using ARNS', 'ARNS is an independent social companion for AniList. You are responsible for what you post and for treating other members with care. Do not use the service to threaten, harass, impersonate, or share unlawful material.'],
    ['Your AniList account', 'AniList remains the home for your lists and progress. ARNS stores media IDs for social features and keeps an encrypted AniList token only for the explicit Add to my AniList action. You can disconnect that access or request deletion of your ARNS account.'],
    ['Availability', 'This is a personal project. Features can change, be unavailable, or be removed. Community posts and public emoji may be visible to other signed-in members.'],
    ['Contact and enforcement', 'Community moderators may remove content or limit access when these guidelines are broken. These draft terms are a starting point and have not been reviewed by a lawyer.'],
  ] },
  privacy: { title: 'Privacy', eyebrow: 'WHAT ARNS KEEPS', sections: [
    ['Account details', 'ARNS keeps your account ID and the small amount of profile information needed to show who is chatting. AniList titles, covers, lists, scores, and progress are fetched live and are not copied into ARNS.'],
    ['Social content', 'Messages, recommendations, community posts, moderation reports, and community emoji records are stored so those features work. AniList media IDs and episode numbers may accompany posts.'],
    ['AniList access', 'If you use Add to my AniList, the AniList token is encrypted and held on the server. It never enters the browser. Disconnecting removes the stored token.'],
    ['Deletion', 'Delete my data removes your ARNS account and associated rows, including your stored AniList token and emoji files you uploaded or that belong to communities you created. Deletion does not remove content or list entries on AniList.'],
    ['Limits of this draft', 'This page is a plain-language project draft, not legal advice. Review and update it before opening the service to the public.'],
  ] },
  guidelines: { title: 'Community Guidelines', eyebrow: 'MAKE ROOM FOR EACH OTHER', sections: [
    ['Be kind and specific', 'Disagree with an idea without targeting the person. No harassment, threats, hate, doxxing, or impersonation.'],
    ['Give spoilers a label', 'Mark the highest episode you discuss when a thread or post could spoil a story. Spoiler blur is a courtesy, not a security boundary.'],
    ['Keep communities on topic', 'Respect each community’s purpose. Don’t flood channels, evade a mute or ban, or upload content you do not have rights to share.'],
    ['Report, don’t pile on', 'Use reports for content that needs attention. Moderators may remove posts, mute or remove members, and ban accounts. Site admins may act across ARNS.'],
  ] },
} as const

export default function LegalPage() {
  const { page = 'terms' } = useParams()
  const content = pages[page as keyof typeof pages]
  if (!content) return <section className="simple-page"><h1>That page isn’t here.</h1><Link className="button button-outline" to="/">Back to your space</Link></section>
  return <section className="legal-page"><span className="eyebrow">{content.eyebrow}</span><h1>{content.title}<span className="heading-period">.</span></h1><p className="legal-draft-note">These are honest project drafts. They are not legal advice.</p><div className="legal-sections">{content.sections.map(([heading, body]) => <article key={heading}><h2>{heading}</h2><p>{body}</p></article>)}</div><nav className="legal-tabs" aria-label="Legal pages"><Link to="/legal/terms">Terms</Link><Link to="/legal/privacy">Privacy</Link><Link to="/legal/guidelines">Community Guidelines</Link></nav></section>
}
