import { Link } from "react-router-dom";
import { LegalDocument } from "../components/LegalDocument";

export function Terms() {
  return <LegalDocument title="Terms of Service" lead="A few clear boundaries for a small, personal spending companion. Here is what you can expect, and what I ask in return." sections={[
    { id: "companion", title: "A companion, with clear boundaries", content: <>
      <p>I built NayaSpend for my own spending, then made it a companion others could use. It organizes transaction records into categories, budgets and trends. It is not a bank, a financial institution, a payment service or a place to hold money.</p>
      <p>NayaSpend is independent: it is not affiliated with, endorsed by, or an official product of NayaPay. It cannot move your money. Nothing here is financial, investment, tax or legal advice. Your decisions stay yours.</p>
    </> },
    { id: "using", title: "Using it thoughtfully", content: <>
      <p>By using NayaSpend, you agree to these terms. Use it only for accounts, emails and statements you own or have permission to access. Keep your sign-in secure and tell me through the project's GitHub if you suspect someone else has accessed your account.</p>
      <p>Please do not use the service for unlawful activity, upload malicious files, probe other people's accounts, bypass access controls or overload the service. Do not misrepresent your identity or use someone else's spending records without permission.</p>
    </> },
    { id: "connections", title: "Your inbox, your permission", content: <>
      <p>Connecting Gmail is optional and uses read-only access with your consent; see our <Link to="/privacy">Privacy Policy</Link> for exactly what this means.</p>
    </> },
    { id: "ownership", title: "Your data stays yours", content: <>
      <p>You retain ownership of your emails, statements and spending records; using NayaSpend does not transfer that ownership.</p>
    </> },
    { id: "availability", title: "One person, doing their best", content: <>
      <p>This is an independent personal project, not a commercial service with a support team. I try to keep it useful, but cannot promise uninterrupted availability, a response time, ongoing support or that every feature will remain available.</p>
      <p>Parsing and categories can be wrong, imports can miss a transaction and trends can be incomplete. Check important amounts against your original statement. Features may change, pause or end; where practical, I will give notice of a significant interruption.</p>
    </> },
    { id: "responsibility", title: "A fair word about responsibility", content: <>
      <p>The service is provided as available, without a promise that it will be error-free or suit every purpose. To the extent the law allows, I am not responsible for losses caused by outages, missing or incorrect records, lost data or decisions made using the service, including indirect or consequential losses.</p>
      <p>This does not exclude responsibility that cannot legally be excluded, or take away rights you have under applicable law. Please do not rely on a personal project as your only record or as the basis for a time-sensitive financial decision.</p>
    </> },
    { id: "leaving", title: "You can leave at any time", content: <>
      <p>You may stop using NayaSpend and delete your account at any time under these terms. The <Link to="/privacy#control">Privacy Policy</Link> explains how to revoke access and request deletion of stored data.</p>
      <p>I may restrict or end access if an account is used abusively, compromises security or breaks these terms. I may also close the project. Where practical, I will explain the reason and give you time to retrieve your records before closure.</p>
    </> },
    { id: "changes", title: "If these terms change", content: <>
      <p>I may update these terms as the project develops. The current version will be posted here with an updated date. For a material change, I will give notice in the app before it takes effect where practical.</p>
      <p>If you do not agree with an update, you can stop using the service and delete your data. Continued use after the updated terms take effect means you accept them.</p>
    </> },
    { id: "contact", title: "A real person to contact", content: <>
      <p>For questions about these terms, contact me through the project's GitHub. There is no company support desk behind NayaSpend. For data requests and private contact guidance, see the <Link to="/privacy#contact">Privacy Policy</Link>.</p>
    </> },
  ]} />;
}
