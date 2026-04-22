import {
  canCreateProperty,
  canUpdateProperty,
  canUploadPropertyImage,
  canCreateListing,
  canUpdateListing,
  canSeeDraftListings,
  canScheduleShowing,
  canAddShowingFeedback,
  canCreateTransaction,
  canMakeOffer,
  canSubmitOffer,
  canCounterOrWithdrawOffer,
  canRejectOrAcceptOffer,
  canOrderAppraisal,
  canWaiveAppraisal,
  canSignDocument,
  canUploadDocumentType,
  getAllowedDocumentTypesForUpload,
  getAllowedPartyRolesForNewTransaction,
  getAllowedInitialStatesForNewTransaction,
} from "@/lib/permissions";
import type { UserRole } from "@/types/api";

const LISTING_SIDE_ROLES: UserRole[] = ["SELLER_AGENT", "SELLER", "ADMIN"];
const BUYER_SIDE_ROLES: UserRole[] = ["BUYER", "BUYER_AGENT"];
const LENDER_ESCROW: UserRole[] = ["LENDER", "ESCROW_OFFICER"];
const ALL_ROLES: UserRole[] = [
  "SELLER_AGENT",
  "SELLER",
  "ADMIN",
  "BUYER",
  "BUYER_AGENT",
  "LENDER",
  "ESCROW_OFFICER",
];

describe("permissions", () => {
  describe("canCreateProperty", () => {
    it("returns true for SELLER_AGENT, SELLER, ADMIN", () => {
      LISTING_SIDE_ROLES.forEach((role) => {
        expect(canCreateProperty(role)).toBe(true);
      });
    });
    it("returns false for BUYER, BUYER_AGENT, LENDER, ESCROW_OFFICER", () => {
      [...BUYER_SIDE_ROLES, ...LENDER_ESCROW].forEach((role) => {
        expect(canCreateProperty(role)).toBe(false);
      });
    });
  });

  describe("canUpdateProperty", () => {
    it("returns true for listing-side roles only", () => {
      LISTING_SIDE_ROLES.forEach((role) => expect(canUpdateProperty(role)).toBe(true));
      BUYER_SIDE_ROLES.forEach((role) => expect(canUpdateProperty(role)).toBe(false));
    });
  });

  describe("canUploadPropertyImage", () => {
    it("returns true for SELLER_AGENT, SELLER, ADMIN", () => {
      LISTING_SIDE_ROLES.forEach((role) => expect(canUploadPropertyImage(role)).toBe(true));
    });
    it("returns false for BUYER so buyers cannot see upload UI", () => {
      expect(canUploadPropertyImage("BUYER")).toBe(false);
      expect(canUploadPropertyImage("BUYER_AGENT")).toBe(false);
    });
  });

  describe("canCreateListing", () => {
    it("returns true for SELLER_AGENT, SELLER, ADMIN", () => {
      LISTING_SIDE_ROLES.forEach((role) => expect(canCreateListing(role)).toBe(true));
    });
    it("returns false for BUYER, LENDER, ESCROW_OFFICER", () => {
      expect(canCreateListing("BUYER")).toBe(false);
      expect(canCreateListing("LENDER")).toBe(false);
      expect(canCreateListing("ESCROW_OFFICER")).toBe(false);
    });
  });

  describe("canSeeDraftListings", () => {
    it("returns false for BUYER and BUYER_AGENT (RLS: buyers cannot see DRAFT)", () => {
      expect(canSeeDraftListings("BUYER")).toBe(false);
      expect(canSeeDraftListings("BUYER_AGENT")).toBe(false);
    });
    it("returns true for SELLER_AGENT, SELLER, ADMIN, LENDER, ESCROW_OFFICER", () => {
      expect(canSeeDraftListings("SELLER_AGENT")).toBe(true);
      expect(canSeeDraftListings("SELLER")).toBe(true);
      expect(canSeeDraftListings("ADMIN")).toBe(true);
      expect(canSeeDraftListings("LENDER")).toBe(true);
      expect(canSeeDraftListings("ESCROW_OFFICER")).toBe(true);
    });
  });

  describe("canUpdateListing", () => {
    it("returns true for listing agent/broker roles (publish/unpublish)", () => {
      LISTING_SIDE_ROLES.forEach((role) => expect(canUpdateListing(role)).toBe(true));
    });
    it("returns false for BUYER and BUYER_AGENT", () => {
      expect(canUpdateListing("BUYER")).toBe(false);
      expect(canUpdateListing("BUYER_AGENT")).toBe(false);
    });
  });

  describe("canScheduleShowing", () => {
    it("returns true for SELLER_AGENT, SELLER, ADMIN", () => {
      LISTING_SIDE_ROLES.forEach((role) => expect(canScheduleShowing(role)).toBe(true));
    });
    it("returns false for BUYER", () => {
      expect(canScheduleShowing("BUYER")).toBe(false);
    });
  });

  describe("canAddShowingFeedback", () => {
    it("returns true for listing agent/broker only", () => {
      LISTING_SIDE_ROLES.forEach((role) => expect(canAddShowingFeedback(role)).toBe(true));
    });
    it("returns false for BUYER (backend returns 403)", () => {
      expect(canAddShowingFeedback("BUYER")).toBe(false);
    });
  });

  describe("canCreateTransaction", () => {
    it("returns true for SELLER_AGENT, SELLER, ADMIN", () => {
      ["SELLER_AGENT", "SELLER", "ADMIN"].forEach((role) =>
        expect(canCreateTransaction(role as UserRole)).toBe(true)
      );
    });
    it("returns false for BUYER, LENDER, ESCROW_OFFICER", () => {
      expect(canCreateTransaction("BUYER")).toBe(false);
      expect(canCreateTransaction("LENDER")).toBe(false);
      expect(canCreateTransaction("ESCROW_OFFICER")).toBe(false);
    });
  });

  describe("canMakeOffer", () => {
    it("returns true for BUYER and BUYER_AGENT", () => {
      expect(canMakeOffer("BUYER")).toBe(true);
      expect(canMakeOffer("BUYER_AGENT")).toBe(true);
    });
    it("returns false for SELLER_AGENT, SELLER, LENDER, ESCROW_OFFICER", () => {
      expect(canMakeOffer("SELLER_AGENT")).toBe(false);
      expect(canMakeOffer("SELLER")).toBe(false);
      expect(canMakeOffer("LENDER")).toBe(false);
      expect(canMakeOffer("ESCROW_OFFICER")).toBe(false);
    });
  });

  describe("canSubmitOffer", () => {
    it("returns true for BUYER and BUYER_AGENT", () => {
      expect(canSubmitOffer("BUYER")).toBe(true);
      expect(canSubmitOffer("BUYER_AGENT")).toBe(true);
    });
    it("returns false for SELLER", () => {
      expect(canSubmitOffer("SELLER")).toBe(false);
    });
  });

  describe("canCounterOrWithdrawOffer", () => {
    it("returns true for BUYER and BUYER_AGENT", () => {
      expect(canCounterOrWithdrawOffer("BUYER")).toBe(true);
      expect(canCounterOrWithdrawOffer("BUYER_AGENT")).toBe(true);
    });
    it("returns false for SELLER_AGENT", () => {
      expect(canCounterOrWithdrawOffer("SELLER_AGENT")).toBe(false);
    });
  });

  describe("canRejectOrAcceptOffer", () => {
    it("returns true for SELLER and SELLER_AGENT", () => {
      expect(canRejectOrAcceptOffer("SELLER")).toBe(true);
      expect(canRejectOrAcceptOffer("SELLER_AGENT")).toBe(true);
    });
    it("returns false for BUYER and BUYER_AGENT", () => {
      expect(canRejectOrAcceptOffer("BUYER")).toBe(false);
      expect(canRejectOrAcceptOffer("BUYER_AGENT")).toBe(false);
    });
  });

  describe("canOrderAppraisal", () => {
    it("returns true only for LENDER and ESCROW_OFFICER", () => {
      expect(canOrderAppraisal("LENDER")).toBe(true);
      expect(canOrderAppraisal("ESCROW_OFFICER")).toBe(true);
    });
    it("returns false for SELLER_AGENT, BUYER, etc.", () => {
      expect(canOrderAppraisal("SELLER_AGENT")).toBe(false);
      expect(canOrderAppraisal("BUYER")).toBe(false);
      expect(canOrderAppraisal("ADMIN")).toBe(false);
    });
  });

  describe("canWaiveAppraisal", () => {
    it("returns true only for BUYER_AGENT", () => {
      expect(canWaiveAppraisal("BUYER_AGENT")).toBe(true);
    });
    it("returns false for BUYER, SELLER_AGENT, LENDER, ESCROW_OFFICER", () => {
      expect(canWaiveAppraisal("BUYER")).toBe(false);
      expect(canWaiveAppraisal("SELLER_AGENT")).toBe(false);
      expect(canWaiveAppraisal("LENDER")).toBe(false);
      expect(canWaiveAppraisal("ESCROW_OFFICER")).toBe(false);
    });
  });

  describe("canSignDocument", () => {
    it("returns true for party-capable roles (BUYER, SELLER, agents, ESCROW_OFFICER, LENDER, ADMIN)", () => {
      ["BUYER", "SELLER", "BUYER_AGENT", "SELLER_AGENT", "ESCROW_OFFICER", "LENDER", "ADMIN"].forEach((role) => {
        expect(canSignDocument(role as UserRole)).toBe(true);
      });
    });
    it("returns false for APPRAISER and INSPECTOR (not typically transaction signers)", () => {
      expect(canSignDocument("APPRAISER")).toBe(false);
      expect(canSignDocument("INSPECTOR")).toBe(false);
    });
  });

  describe("canUploadDocumentType", () => {
    it("denies inspection_report for LENDER in any state", () => {
      expect(canUploadDocumentType("LENDER", "inspection_report", "DUE_DILIGENCE")).toBe(false);
      expect(canUploadDocumentType("LENDER", "inspection_report", "LISTED")).toBe(false);
    });
    it("allows inspection_report for non-LENDER roles", () => {
      expect(canUploadDocumentType("BUYER", "inspection_report", "DUE_DILIGENCE")).toBe(true);
      expect(canUploadDocumentType("SELLER_AGENT", "inspection_report", "OFFER_MADE")).toBe(true);
    });
    it("allows offer only when LISTED and BUYER or BUYER_AGENT", () => {
      expect(canUploadDocumentType("BUYER", "offer", "LISTED")).toBe(true);
      expect(canUploadDocumentType("BUYER_AGENT", "offer", "LISTED")).toBe(true);
      expect(canUploadDocumentType("BUYER", "offer", "OFFER_MADE")).toBe(false);
      expect(canUploadDocumentType("SELLER", "offer", "LISTED")).toBe(false);
    });
    it("allows purchase_agreement only when OFFER_MADE and SELLER or SELLER_AGENT", () => {
      expect(canUploadDocumentType("SELLER", "purchase_agreement", "OFFER_MADE")).toBe(true);
      expect(canUploadDocumentType("SELLER_AGENT", "purchase_agreement", "OFFER_MADE")).toBe(true);
      expect(canUploadDocumentType("SELLER", "purchase_agreement", "UNDER_CONTRACT")).toBe(false);
      expect(canUploadDocumentType("BUYER", "purchase_agreement", "OFFER_MADE")).toBe(false);
    });
    it("allows escrow_instructions only when UNDER_CONTRACT and ESCROW_OFFICER", () => {
      expect(canUploadDocumentType("ESCROW_OFFICER", "escrow_instructions", "UNDER_CONTRACT")).toBe(true);
      expect(canUploadDocumentType("ESCROW_OFFICER", "escrow_instructions", "DUE_DILIGENCE")).toBe(false);
      expect(canUploadDocumentType("BUYER", "escrow_instructions", "UNDER_CONTRACT")).toBe(false);
    });
    it("allows loan_commitment only when FINANCING and LENDER", () => {
      expect(canUploadDocumentType("LENDER", "loan_commitment", "FINANCING")).toBe(true);
      expect(canUploadDocumentType("LENDER", "loan_commitment", "CLEAR_TO_CLOSE")).toBe(false);
      expect(canUploadDocumentType("ESCROW_OFFICER", "loan_commitment", "FINANCING")).toBe(false);
    });
    it("allows funding_confirmation only when CLEAR_TO_CLOSE and ESCROW_OFFICER", () => {
      expect(canUploadDocumentType("ESCROW_OFFICER", "funding_confirmation", "CLEAR_TO_CLOSE")).toBe(true);
      expect(canUploadDocumentType("ESCROW_OFFICER", "funding_confirmation", "CLOSED")).toBe(false);
      expect(canUploadDocumentType("LENDER", "funding_confirmation", "CLEAR_TO_CLOSE")).toBe(false);
    });
    it("allows party-uploadable types (e.g. other, listing_agreement) for any role and state", () => {
      expect(canUploadDocumentType("BUYER", "other", "LISTED")).toBe(true);
      expect(canUploadDocumentType("LENDER", "pre_qualification_letter", "FINANCING")).toBe(true);
      expect(canUploadDocumentType("SELLER_AGENT", "listing_agreement", "PRE_LISTING")).toBe(true);
    });
    it("allows appraisal_report only for LENDER, ESCROW_OFFICER, APPRAISER in DUE_DILIGENCE/FINANCING/CLEAR_TO_CLOSE", () => {
      expect(canUploadDocumentType("LENDER", "appraisal_report", "DUE_DILIGENCE")).toBe(true);
      expect(canUploadDocumentType("ESCROW_OFFICER", "appraisal_report", "FINANCING")).toBe(true);
      expect(canUploadDocumentType("APPRAISER", "appraisal_report", "CLEAR_TO_CLOSE")).toBe(true);
      expect(canUploadDocumentType("BUYER", "appraisal_report", "DUE_DILIGENCE")).toBe(false);
      expect(canUploadDocumentType("SELLER", "appraisal_report", "FINANCING")).toBe(false);
      expect(canUploadDocumentType("LENDER", "appraisal_report", "LISTED")).toBe(false);
    });
  });

  describe("getAllowedDocumentTypesForUpload", () => {
    it("returns list that excludes inspection_report for LENDER", () => {
      const list = getAllowedDocumentTypesForUpload("LENDER", "DUE_DILIGENCE");
      expect(list).not.toContain("inspection_report");
      expect(list).toContain("other");
    });
    it("includes offer for BUYER in LISTED only", () => {
      expect(getAllowedDocumentTypesForUpload("BUYER", "LISTED")).toContain("offer");
      expect(getAllowedDocumentTypesForUpload("BUYER", "OFFER_MADE")).not.toContain("offer");
    });
    it("includes purchase_agreement for SELLER in OFFER_MADE only", () => {
      expect(getAllowedDocumentTypesForUpload("SELLER", "OFFER_MADE")).toContain("purchase_agreement");
      expect(getAllowedDocumentTypesForUpload("SELLER", "UNDER_CONTRACT")).not.toContain("purchase_agreement");
    });
    it("includes escrow_instructions for ESCROW_OFFICER in UNDER_CONTRACT only", () => {
      expect(getAllowedDocumentTypesForUpload("ESCROW_OFFICER", "UNDER_CONTRACT")).toContain("escrow_instructions");
      expect(getAllowedDocumentTypesForUpload("ESCROW_OFFICER", "DUE_DILIGENCE")).not.toContain("escrow_instructions");
    });
    it("includes loan_commitment for LENDER in FINANCING only", () => {
      expect(getAllowedDocumentTypesForUpload("LENDER", "FINANCING")).toContain("loan_commitment");
      expect(getAllowedDocumentTypesForUpload("LENDER", "CLEAR_TO_CLOSE")).not.toContain("loan_commitment");
    });
    it("includes funding_confirmation for ESCROW_OFFICER in CLEAR_TO_CLOSE only", () => {
      expect(getAllowedDocumentTypesForUpload("ESCROW_OFFICER", "CLEAR_TO_CLOSE")).toContain("funding_confirmation");
      expect(getAllowedDocumentTypesForUpload("ESCROW_OFFICER", "CLOSED")).not.toContain("funding_confirmation");
    });
    it("includes appraisal_report only for LENDER/ESCROW_OFFICER/APPRAISER in relevant states", () => {
      expect(getAllowedDocumentTypesForUpload("LENDER", "DUE_DILIGENCE")).toContain("appraisal_report");
      expect(getAllowedDocumentTypesForUpload("ESCROW_OFFICER", "FINANCING")).toContain("appraisal_report");
      expect(getAllowedDocumentTypesForUpload("BUYER", "DUE_DILIGENCE")).not.toContain("appraisal_report");
      expect(getAllowedDocumentTypesForUpload("SELLER", "FINANCING")).not.toContain("appraisal_report");
    });
  });

  describe("getAllowedPartyRolesForNewTransaction", () => {
    it("returns SELLER_AGENT and SELLER for SELLER_AGENT", () => {
      expect(getAllowedPartyRolesForNewTransaction("SELLER_AGENT")).toEqual(["SELLER_AGENT", "SELLER"]);
    });
    it("returns only SELLER for SELLER", () => {
      expect(getAllowedPartyRolesForNewTransaction("SELLER")).toEqual(["SELLER"]);
    });
    it("returns SELLER_AGENT and SELLER for ADMIN", () => {
      expect(getAllowedPartyRolesForNewTransaction("ADMIN")).toEqual(["SELLER_AGENT", "SELLER"]);
    });
    it("returns empty for buyer-side and other roles", () => {
      expect(getAllowedPartyRolesForNewTransaction("BUYER")).toEqual([]);
      expect(getAllowedPartyRolesForNewTransaction("LENDER")).toEqual([]);
    });
  });

  describe("getAllowedInitialStatesForNewTransaction", () => {
    it("returns PRE_LISTING and LISTED", () => {
      expect(getAllowedInitialStatesForNewTransaction()).toEqual(["PRE_LISTING", "LISTED"]);
    });
  });

  describe("consistency across all roles", () => {
    it("every role is covered by at least one permission or explicitly denied", () => {
      [...ALL_ROLES, "APPRAISER", "INSPECTOR"].forEach((role) => {
        const canDoSomething =
          canCreateProperty(role) ||
          canUploadPropertyImage(role) ||
          canCreateListing(role) ||
          canUpdateListing(role) ||
          canScheduleShowing(role) ||
          canAddShowingFeedback(role) ||
          canCreateTransaction(role) ||
          canOrderAppraisal(role) ||
          canWaiveAppraisal(role) ||
          canSignDocument(role);
        expect(typeof canDoSomething).toBe("boolean");
      });
    });
  });
});
