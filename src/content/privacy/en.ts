import type { LegalContent } from "@/lib/types/legal";
import { CONTACT_EMAIL } from "@/lib/config";

const content: LegalContent = {
  lastUpdated: "2026-04-22T00:00:00Z",
  sections: [
    {
      id: "collection",
      title: "Information We Collect",
      blocks: [
        {
          kind: "subgroup",
          label: "Automatically collected (by third-party processors)",
          intro:
            "The following is collected by our hosting, analytics, and CDN providers (Vercel, Google Analytics, Cloudflare) as a necessary part of serving the website. OpenSetlist does not store this data in its own database.",
          items: [
            "IP address, visit logs, cookies",
            "Browser type, operating system",
            "Pages visited, time spent",
          ],
        },
        {
          kind: "subgroup",
          label: "Browser Local Storage (localStorage)",
          items: [
            "`opensetlist_first_visit`: timestamp of first visit (used for return-visitor UI).",
            "`opensetlist_anon_id`: anonymous identifier (UUID). Used to prevent duplicate submissions and, when you create an account in the future, to link contributions you made anonymously to that account. This identifier is stored on our servers but is not linked to your IP address or any other personal information.",
            "Clearing your browser site data resets this identifier and severs the link to any prior anonymous contributions.",
          ],
        },
        {
          kind: "subgroup",
          label: "On registration (Phase 2)",
          items: ["Email address", "Username"],
        },
      ],
    },
    {
      id: "purpose",
      title: "How We Use Information",
      blocks: [
        {
          kind: "ul",
          items: [
            "Provide and improve the service",
            "Visitor analytics (Google Analytics)",
            "Advertising (Google AdSense, Kakao AdFit)",
          ],
        },
      ],
    },
    {
      id: "cookies",
      title: "Cookies",
      blocks: [
        { kind: "p", text: "We use cookies for:" },
        {
          kind: "ul",
          items: [
            "Google Analytics: visitor statistics",
            "Google AdSense: personalized ads",
            "Kakao AdFit: personalized ads",
          ],
        },
        {
          kind: "note",
          text: "You can disable cookies in your browser settings.",
        },
      ],
    },
    {
      id: "thirdparty",
      title: "Third Parties",
      blocks: [
        {
          kind: "p",
          text: "We share data only with the processors and advertising partners listed below.",
        },
        {
          kind: "subgroup",
          label: "Hosting / Analytics / CDN processors",
          items: [
            "Vercel (hosting)",
            "Google Analytics (visitor analytics)",
            "Cloudflare (CDN)",
          ],
        },
        {
          kind: "subgroup",
          label: "Advertising partners",
          items: ["Google AdSense", "Kakao AdFit"],
        },
      ],
    },
    {
      id: "retention",
      title: "Data Retention",
      blocks: [
        {
          kind: "ul",
          items: [
            "Retained during service usage",
            "Deleted immediately upon account deletion",
            "Retained as required by law",
          ],
        },
      ],
    },
    {
      id: "rights",
      title: "Your Rights",
      blocks: [
        {
          kind: "p",
          text: "You may exercise the following rights at any time.",
        },
        {
          kind: "ul",
          items: [
            "Request access to your personal data",
            "Request correction of your personal data",
            "Request deletion of your personal data",
            "Request to stop processing your personal data",
          ],
        },
      ],
    },
    {
      id: "contact",
      title: "Contact",
      blocks: [{ kind: "contact", email: CONTACT_EMAIL }],
    },
  ],
};

export default content;
