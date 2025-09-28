import { describe, it, expect, beforeEach } from "vitest";

const ERR_INVALID_PROOF = 100;
const ERR_NOT_AUTHORIZED = 101;
const ERR_INVALID_SUBMISSION_ID = 102;
const ERR_PROOF_ALREADY_VERIFIED = 103;
const ERR_INVALID_PUBLIC_INPUTS = 104;
const ERR_INVALID_PROOF_LENGTH = 105;
const ERR_INVALID_PUBLIC_INPUTS_LENGTH = 106;
const ERR_NO_VERIFICATION_KEY = 107;
const ERR_INVALID_VERIFICATION_KEY = 108;
const ERR_INVALID_PROOF_TYPE = 109;
const ERR_MAX_PROOFS_EXCEEDED = 110;
const ERR_INVALID_TIMESTAMP = 111;
const ERR_USER_NOT_REGISTERED = 112;
const ERR_INVALID_AGGREGATE_ID = 113;
const ERR_AGGREGATE_NOT_FOUND = 114;
const ERR_INVALID_EMISSION_VALUE = 115;
const ERR_INVALID_CATEGORY = 116;
const ERR_ADMIN_ONLY = 117;
const ERR_INVALID_ADMIN = 118;
const ERR_PAUSED = 119;
const ERR_NOT_PAUSED = 120;

interface VerificationResult {
  isValid: boolean;
  timestamp: number;
  emissionValue: number;
  category: string;
}

interface Aggregate {
  totalEmissions: number;
  count: number;
  average: number;
  category: string;
  timestamp: number;
}

interface Result<T> {
  ok: boolean;
  value: T;
}

class ZKVerifierMock {
  state: {
    contractAdmin: string;
    isPaused: boolean;
    maxProofsPerUser: number;
    verificationKey: string;
    nextSubmissionId: number;
    nextAggregateId: number;
    userRegistrations: Map<string, boolean>;
    verificationResults: Map<string, VerificationResult>;
    userProofCounts: Map<string, number>;
    aggregates: Map<number, Aggregate>;
    proofTypes: Map<string, boolean>;
  } = {
    contractAdmin: "",
    isPaused: false,
    maxProofsPerUser: 100,
    verificationKey: "",
    nextSubmissionId: 0,
    nextAggregateId: 0,
    userRegistrations: new Map(),
    verificationResults: new Map(),
    userProofCounts: new Map(),
    aggregates: new Map(),
    proofTypes: new Map(),
  };
  blockHeight: number = 0;
  caller: string = "ST1ADMIN";
  events: Array<{ event: string; [key: string]: any }> = [];

  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      contractAdmin: this.caller,
      isPaused: false,
      maxProofsPerUser: 100,
      verificationKey: "",
      nextSubmissionId: 0,
      nextAggregateId: 0,
      userRegistrations: new Map(),
      verificationResults: new Map(),
      userProofCounts: new Map(),
      aggregates: new Map(),
      proofTypes: new Map(),
    };
    this.blockHeight = 0;
    this.events = [];
  }

  getVerificationResult(user: string, submissionId: number): VerificationResult | null {
    return this.state.verificationResults.get(`${user}-${submissionId}`) || null;
  }

  getAggregate(aggregateId: number): Aggregate | null {
    return this.state.aggregates.get(aggregateId) || null;
  }

  getUserProofCount(user: string): number {
    return this.state.userProofCounts.get(user) || 0;
  }

  isUserRegistered(user: string): boolean {
    return this.state.userRegistrations.get(user) || false;
  }

  getContractAdmin(): string {
    return this.state.contractAdmin;
  }

  getIsPaused(): boolean {
    return this.state.isPaused;
  }

  getMaxProofsPerUser(): number {
    return this.state.maxProofsPerUser;
  }

  getVerificationKey(): string {
    return this.state.verificationKey;
  }

  registerUser(): Result<boolean> {
    if (this.state.isPaused) return { ok: false, value: ERR_PAUSED };
    if (this.isUserRegistered(this.caller)) return { ok: false, value: ERR_USER_NOT_REGISTERED };
    this.state.userRegistrations.set(this.caller, true);
    return { ok: true, value: true };
  }

  verifyProof(submissionId: number, proof: string, publicInputs: string, emissionValue: number, category: string, proofType: string): Result<boolean> {
    if (this.state.isPaused) return { ok: false, value: ERR_PAUSED };
    if (!this.isUserRegistered(this.caller)) return { ok: false, value: ERR_USER_NOT_REGISTERED };
    if (proof.length !== 512) return { ok: false, value: ERR_INVALID_PROOF_LENGTH };
    if (publicInputs.length !== 256) return { ok: false, value: ERR_INVALID_PUBLIC_INPUTS_LENGTH };
    if (emissionValue <= 0) return { ok: false, value: ERR_INVALID_EMISSION_VALUE };
    if (category.length === 0 || category.length > 32) return { ok: false, value: ERR_INVALID_CATEGORY };
    if (!this.state.proofTypes.has(proofType)) return { ok: false, value: ERR_INVALID_PROOF_TYPE };
    const proofCount = this.getUserProofCount(this.caller);
    if (proofCount >= this.state.maxProofsPerUser) return { ok: false, value: ERR_MAX_PROOFS_EXCEEDED };
    if (this.getVerificationResult(this.caller, submissionId)) return { ok: false, value: ERR_PROOF_ALREADY_VERIFIED };
    const isValid = this.state.verificationKey !== "" && this.hash(proof + publicInputs) === this.hash(this.state.verificationKey);
    if (!isValid) return { ok: false, value: ERR_INVALID_PROOF };
    this.state.verificationResults.set(`${this.caller}-${submissionId}`, { isValid: true, timestamp: this.blockHeight, emissionValue, category });
    this.state.userProofCounts.set(this.caller, proofCount + 1);
    this.events.push({ event: "proof-verified", user: this.caller, submissionId, emissionValue, category });
    return { ok: true, value: true };
  }

  createAggregate(category: string): Result<number> {
    if (this.state.isPaused) return { ok: false, value: ERR_PAUSED };
    if (this.caller !== this.state.contractAdmin) return { ok: false, value: ERR_ADMIN_ONLY };
    if (category.length === 0 || category.length > 32) return { ok: false, value: ERR_INVALID_CATEGORY };
    const aggregateId = this.state.nextAggregateId;
    this.state.aggregates.set(aggregateId, { totalEmissions: 0, count: 0, average: 0, category, timestamp: this.blockHeight });
    this.state.nextAggregateId++;
    this.events.push({ event: "aggregate-created", aggregateId, category });
    return { ok: true, value: aggregateId };
  }

  updateAggregate(aggregateId: number, additionalEmissions: number, additionalCount: number): Result<boolean> {
    if (this.state.isPaused) return { ok: false, value: ERR_PAUSED };
    if (this.caller !== this.state.contractAdmin) return { ok: false, value: ERR_ADMIN_ONLY };
    if (additionalEmissions <= 0) return { ok: false, value: ERR_INVALID_EMISSION_VALUE };
    if (additionalCount <= 0) return { ok: false, value: ERR_INVALID_SUBMISSION_ID };
    const aggregate = this.state.aggregates.get(aggregateId);
    if (!aggregate) return { ok: false, value: ERR_AGGREGATE_NOT_FOUND };
    const newTotal = aggregate.totalEmissions + additionalEmissions;
    const newCount = aggregate.count + additionalCount;
    const newAverage = newCount > 0 ? Math.floor(newTotal / newCount) : 0;
    this.state.aggregates.set(aggregateId, { ...aggregate, totalEmissions: newTotal, count: newCount, average: newAverage, timestamp: this.blockHeight });
    this.events.push({ event: "aggregate-updated", aggregateId, newTotal, newAverage: newAverage });
    return { ok: true, value: true };
  }

  setVerificationKey(newKey: string): Result<boolean> {
    if (this.caller !== this.state.contractAdmin) return { ok: false, value: ERR_ADMIN_ONLY };
    if (newKey === "") return { ok: false, value: ERR_INVALID_VERIFICATION_KEY };
    this.state.verificationKey = newKey;
    return { ok: true, value: true };
  }

  setMaxProofsPerUser(newMax: number): Result<boolean> {
    if (this.caller !== this.state.contractAdmin) return { ok: false, value: ERR_ADMIN_ONLY };
    if (newMax <= 0) return { ok: false, value: ERR_INVALID_MAX_MEMBERS };
    this.state.maxProofsPerUser = newMax;
    return { ok: true, value: true };
  }

  addProofType(proofType: string): Result<boolean> {
    if (this.caller !== this.state.contractAdmin) return { ok: false, value: ERR_ADMIN_ONLY };
    if (proofType.length === 0 || proofType.length > 32) return { ok: false, value: ERR_INVALID_CATEGORY };
    this.state.proofTypes.set(proofType, true);
    return { ok: true, value: true };
  }

  removeProofType(proofType: string): Result<boolean> {
    if (this.caller !== this.state.contractAdmin) return { ok: false, value: ERR_ADMIN_ONLY };
    this.state.proofTypes.delete(proofType);
    return { ok: true, value: true };
  }

  pauseContract(): Result<boolean> {
    if (this.caller !== this.state.contractAdmin) return { ok: false, value: ERR_ADMIN_ONLY };
    if (this.state.isPaused) return { ok: false, value: ERR_NOT_PAUSED };
    this.state.isPaused = true;
    return { ok: true, value: true };
  }

  unpauseContract(): Result<boolean> {
    if (this.caller !== this.state.contractAdmin) return { ok: false, value: ERR_ADMIN_ONLY };
    if (!this.state.isPaused) return { ok: false, value: ERR_PAUSED };
    this.state.isPaused = false;
    return { ok: true, value: true };
  }

  transferAdmin(newAdmin: string): Result<boolean> {
    if (this.caller !== this.state.contractAdmin) return { ok: false, value: ERR_ADMIN_ONLY };
    if (newAdmin === this.caller) return { ok: false, value: ERR_INVALID_ADMIN };
    this.state.contractAdmin = newAdmin;
    return { ok: true, value: true };
  }

  private hash(input: string): string {
    return input.split("").reverse().join("");
  }
}

describe("ZKVerifier", () => {
  let contract: ZKVerifierMock;

  beforeEach(() => {
    contract = new ZKVerifierMock();
    contract.reset();
  });

  it("registers a user successfully", () => {
    const result = contract.registerUser();
    expect(result.ok).toBe(true);
    expect(contract.isUserRegistered("ST1ADMIN")).toBe(true);
  });

  it("rejects registration if paused", () => {
    contract.pauseContract();
    const result = contract.registerUser();
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_PAUSED);
  });

  it("rejects proof verification without key", () => {
    contract.addProofType("type1");
    contract.registerUser();
    contract.caller = "ST1USER";
    contract.registerUser();
    const result = contract.verifyProof(0, "a".repeat(512), "b".repeat(256), 100, "transport", "type1");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_PROOF);
  });

  it("rejects proof verification if not registered", () => {
    const result = contract.verifyProof(0, "a".repeat(512), "b".repeat(256), 100, "transport", "type1");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_USER_NOT_REGISTERED);
  });

  it("creates aggregate successfully", () => {
    const result = contract.createAggregate("energy");
    expect(result.ok).toBe(true);
    expect(result.value).toBe(0);
    const agg = contract.getAggregate(0);
    expect(agg?.category).toBe("energy");
    expect(contract.events[0].event).toBe("aggregate-created");
  });

  it("rejects aggregate creation if not admin", () => {
    contract.caller = "ST2NONADMIN";
    const result = contract.createAggregate("energy");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_ADMIN_ONLY);
  });

  it("updates aggregate successfully", () => {
    contract.createAggregate("energy");
    const result = contract.updateAggregate(0, 500, 5);
    expect(result.ok).toBe(true);
    const agg = contract.getAggregate(0);
    expect(agg?.totalEmissions).toBe(500);
    expect(agg?.count).toBe(5);
    expect(agg?.average).toBe(100);
    expect(contract.events[1].event).toBe("aggregate-updated");
  });

  it("rejects aggregate update if not found", () => {
    const result = contract.updateAggregate(99, 500, 5);
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_AGGREGATE_NOT_FOUND);
  });

  it("sets verification key successfully", () => {
    const result = contract.setVerificationKey("newkey");
    expect(result.ok).toBe(true);
    expect(contract.getVerificationKey()).toBe("newkey");
  });

  it("rejects invalid verification key", () => {
    const result = contract.setVerificationKey("");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_VERIFICATION_KEY);
  });

  it("sets max proofs per user successfully", () => {
    const result = contract.setMaxProofsPerUser(50);
    expect(result.ok).toBe(true);
    expect(contract.getMaxProofsPerUser()).toBe(50);
  });

  it("adds and removes proof type successfully", () => {
    const addResult = contract.addProofType("type2");
    expect(addResult.ok).toBe(true);
    expect(contract.state.proofTypes.has("type2")).toBe(true);
    const removeResult = contract.removeProofType("type2");
    expect(removeResult.ok).toBe(true);
    expect(contract.state.proofTypes.has("type2")).toBe(false);
  });

  it("pauses and unpauses contract successfully", () => {
    const pauseResult = contract.pauseContract();
    expect(pauseResult.ok).toBe(true);
    expect(contract.getIsPaused()).toBe(true);
    const unpauseResult = contract.unpauseContract();
    expect(unpauseResult.ok).toBe(true);
    expect(contract.getIsPaused()).toBe(false);
  });

  it("transfers admin successfully", () => {
    const result = contract.transferAdmin("ST2NEWADMIN");
    expect(result.ok).toBe(true);
    expect(contract.getContractAdmin()).toBe("ST2NEWADMIN");
  });

  it("rejects transfer admin to self", () => {
    const result = contract.transferAdmin("ST1ADMIN");
    expect(result.ok).toBe(false);
    expect(result.value).toBe(ERR_INVALID_ADMIN);
  });
});