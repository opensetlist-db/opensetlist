import type { LegalContent } from "@/lib/types/legal";
import { CONTACT_EMAIL } from "@/lib/config";

const content: LegalContent = {
  lastUpdated: "April 17, 2026",
  sections: [
    {
      id: "intro",
      title: "1. About the Service",
      blocks: [
        {
          kind: "p",
          text: "OpenSetlist is a community database providing setlist information for live events.",
        },
      ],
    },
    {
      id: "conditions",
      title: "2. Terms of Use",
      blocks: [
        {
          kind: "ul",
          items: [
            "The service is provided free of charge",
            "Commercial data scraping or redistribution is prohibited",
            "Submitting false information is prohibited",
          ],
        },
      ],
    },
    {
      id: "copyright",
      title: "3. Copyright",
      blocks: [
        {
          kind: "ul",
          items: [
            "UI/design copyright belongs to OpenSetlist",
            "Performance info and setlists are community-contributed data",
            "Music copyrights belong to their respective owners",
          ],
        },
      ],
    },
    {
      id: "disclaimer",
      title: "4. Disclaimer",
      blocks: [
        {
          kind: "ul",
          items: [
            "We do not guarantee the accuracy of setlist information",
            "We are not liable for damages caused by service interruptions",
          ],
        },
      ],
    },
    {
      id: "contact",
      title: "5. Contact",
      blocks: [{ kind: "contact", email: CONTACT_EMAIL }],
    },
  ],
};

export default content;
