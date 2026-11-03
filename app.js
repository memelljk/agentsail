/* SailAgent — plain JS, no libraries.
   Live data via eth_call against public BSC RPCs (rotating). Wallet actions
   (claim / mint) go through the visitor's own wallet (window.ethereum).
   Selectors computed from the deployed ABIs:
     SailSale: currentRound() 0x8a19c8bc · saleClosed() 0xb8c766b8 · launched() 0x8091f3bf
       freeSold() 0xa37d6e0f · totalRaised() 0xc5c4744c · poolFund() 0xc59aa90e · pool() 0x16f0115b
       priceOf(uint256) 0xb9186d7d · paidCapOf(uint256) 0xee4e87de · paidSoldByRound(uint256) 0x61808075
       paidLotsOf(uint256,address) 0xc88dbeac · freeClaimedByAgent(uint256) 0x57eb282a
       claim(uint256) 0x379607f5 · mint(uint256,address) 0x94bf804d
     SailToken / registry (ERC20 / ERC721): balanceOf(address) 0x70a08231 · ownerOf(uint256) 0x6352211e
       tradingOpen() 0xffb54a99 · totalSupply() 0x18160ddd
     Event ReferralPaid(address,address,uint256) topic0 0x0a721ab4…f75673
     Event Claimed(uint256,address,uint256) topic0 0x4ec90e96…e9ed026
     Event Minted(address,uint256,uint256,uint256,uint256,address) topic0 0x5f476a61…49aecbc2d
     Event RoundOpened(uint256) topic0 0xf5d5acf5…52acad647
     Event PoolLaunched(address,uint256,uint256) topic0 0xbc649ff5…e057869213
   SailPixels NFT + SailPixelsMarket (page #/pixels): no constants at all —
   every selector is computed at runtime from the ABI signatures by selOf()
   (see PSEL below), cross-checked against the deployed ABIs in
   ~/workspace/pixel-sea-nft/dev/artifacts/.
*/
(function () {
  "use strict";

  /* ================= CONFIG — edit addresses / X link here ================= */
  var CONFIG = {
    CHAIN_ID: 56,
    TOKEN: "0x4f818743bE660eCDaE5ccFFC4d2E2494fE96F19c",
    SALE: "0xD29A5c98ac9eee53d41A9561B3320832f7ECd6eA",
    REGISTRY: "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F",
    PIXELS: "0x42bDFFf914afCF12047922AE58be397c1F351a27",
    PIXELS_MKT: "0xF648DADe9438BfAec7Df2C44995012AeA99aEC81",
    X_URL: "https://x.com/SailAgents",
    X_HANDLE: "@SailAgents",
    SALE_DEPLOY_BLOCK: 131122912, // v3 sale deploy tx 0x254919e9… block (verified via eth_getTransactionReceipt)
    LOT_TOKENS: 100000n,           // 1 lot = 100,000 SAIL (contract constant LOT)
    FREE_CAP: 1000n,
    MAX_LOTS: 10n
  };

  var RPCS = ["https://bsc-dataseed1.defibit.io", "https://bsc-dataseed.binance.org", "https://bsc.publicnode.com", "https://bsc-dataseed2.defibit.io"];
  var LOG_RPCS = ["https://rpc.48.club", "https://bsc-dataseed1.defibit.io", "https://bsc.publicnode.com"];
  var SEL = {
    currentRound: "0x8a19c8bc", saleClosed: "0xb8c766b8", launched: "0x8091f3bf",
    freeSold: "0xa37d6e0f", totalRaised: "0xc5c4744c", poolFund: "0xc59aa90e", pool: "0x16f0115b",
    priceOf: "0xb9186d7d", paidCapOf: "0xee4e87de", paidSold: "0x61808075",
    paidLotsOf: "0xc88dbeac", freeClaimed: "0x57eb282a",
    claim: "0x379607f5", mint: "0x94bf804d",
    balanceOf: "0x70a08231", ownerOf: "0x6352211e", totalSupply: "0x18160ddd", tradingOpen: "0xffb54a99"
  };
  var REFERRAL_TOPIC = "0x0a721ab4682ceb61c7e4d264ef879fc419a6d764b136e7d96ef54b2053c75673";
  var TOPICS = {
    claimed: "0x4ec90e965519d92681267467f775ada5bd214aa92c0dc93d90a5e880ce9ed026",
    minted: "0x5f476a6161150ac33452eb8d07dc6b5273aa5068b66161be5e7e6a449aecbc2d",
    referral: REFERRAL_TOPIC,
    roundOpened: "0xf5d5acf597a5f9d06a24389ebea67f576c74da4d4a73b97a5dfac2452acad647",
    poolLaunched: "0xbc649ff513aa4f300c1c4e3ba3c7e15690560da9656005f67154b8e057869213"
  };
  // Fallback spec (matches the contract constants) so cards render before the first read returns.
  var SPEC = [
    { price: 1000000000000000n, cap: 2000n },
    { price: 2000000000000000n, cap: 1500n },
    { price: 3000000000000000n, cap: 1000n },
    { price: 4000000000000000n, cap: 800n },
    { price: 5000000000000000n, cap: 700n }
  ];

  /* ================= i18n ================= */
  var EN = {
    navHome: "Home", navBuy: "Claim / Buy", navPx: "SailPixels", navRef: "Referral", navTok: "Tokenomics", navGuide: "Guide", navFaq: "FAQ", navWp: "Whitepaper", connect: "Connect wallet",
    pxKicker: "SailPixels · NFT Collection", pxTitle: "5,555 pixel ships. Your draw picks yours.",
    pxSub: "SailPixels is SailAgent's pixel-ship NFT collection: 5,555 ships minted across 5 phases. Every mint is a gacha draw — the rarity is pulled from the remaining pool and revealed the moment the mint lands (auto reveal). In Phase 1, the first ship for each wallet is free; the rest sell at the phase price.",
    pxGalT: "Five rarities",
    pxLiveT: "Live Sale",
    pxMintT: "Mint", pxLPhase: "Current phase", pxLPhaseMinted: "Minted this phase", pxLTotal: "Total minted", pxLPrice: "Phase price", pxLMine: "My mints this phase", pxLFree: "Phase-1 free ship",
    pxQtyL: "Quantity", pxMintBtn: "Mint",
    pxMintNote: "Connect your wallet on the Buy page; once connected, the price here is priced live for your wallet.",
    pxMktT: "Market",
    pxMktNote: "Built-in market: a 10% fee on each sale goes to the project; sellers receive 90%. Minimum listing price 0.001 BNB. Listings are non-custodial — your NFT stays in your wallet until the moment it sells, so keep the market approval in place.",
    pxElemNote: "Secondary market: SailPixels also trades on Element Market (BNB Chain).",
    pxElemBtn: "Trade on Element Market",
    pxMyT: "My ships", pxMyOff: "Connect your wallet to see your SailPixels here.", pxScanBtn: "Scan my ships",
    pxListT: "List for sale", pxListTokenL: "Token #", pxListPriceL: "Price (BNB, min 0.001)", pxListBtn: "List",
    pxTokenPh: "e.g. 12", pxPricePh: "0.001",
    pxListNote: "Listing first checks that you own the token; if the market contract is not approved yet, you will be asked for one approval transaction first. You receive 90% when it sells.",
    heroKicker: "BNB Smart Chain · Agent ID holders only",
    heroH1: 'Every agent<br>can <span class="light">set sail</span>.',
    heroIntro: "SailAgent (SAIL) is a sea-voyage community token for Binance Agent ID holders. Round 1 gives a free lot, then four paid rounds follow; 70% of proceeds seed the liquidity pool and referrers instantly earn 10% in BNB.",
    heroCta1: "Claim / Buy SAIL", heroCta2: "Earn referral rewards", heroLoading: "Reading on-chain status…",
    shipHint: "Zheng He's treasure fleet — ride the wind, break the waves",
    statSupply: "Total supply (SAIL)", statLot: "SAIL per lot", statRounds: "Sale rounds · Round 1 includes the free claim", statHours: "12 hours", statPer: "per round limit",
    kLive: "Live Data", liveTitle: "Where the fleet is sailing, right now.",
    liveNote: "Everything below is read directly from the on-chain contracts and refreshes every 30 seconds.",
    cdT: "This round's countdown", cdNote: "This round closes when it sells out or the 12-hour limit expires.", campT: "Campaign progress",
    kBoard: "Leaderboard & Activity", boardTitle: "Who is sailing in front.",
    boardSub: "Rankings and the latest activity are read live from the sale contract's on-chain events (claims, purchases, referral payouts).",
    boardRefresh: "Refresh", buyersT: "Top buyers", refsT: "Top referrers", actT: "Latest activity",
    thRank: "#", thAddr: "Address", thLots: "Lots", thSail: "SAIL", thInv: "Invites", thEarn: "Earned",
    saleT: "Sale status", freeT: "Round 1 free claim", lotsUnit: "lots", freeDesc: "Every Agent ID can claim 1 free lot (100,000 SAIL) in Round 1 — first come, first served.",
    raisedT: "Total raised", raisedDesc: "BNB from paid mints is split the moment each purchase lands: 70% locked for the pool, 10% to the referrer, 5% operations, 15% reserve.",
    balT: "Contract inventory", balSale: "SAIL held by the sale contract", balTrade: "Token transfers",
    balNote: "SAIL stays locked until the liquidity pool opens: only the sale contract can hand it out — it cannot be transferred or traded.",
    poolT: "Liquidity pool plan", poolDesc: "After all five rounds, the pool opens: 70% of raised BNB paired with 150,000,000 SAIL on PancakeSwap V3, and transfers/trading unlock at the same moment.",
    kMarket: "Token Market", tokMktT: "SAIL market",
    tokMktPre: "The SAIL pool has not launched yet. 70% of every paid purchase is held in the sale contract as pool funding; once all five rounds end, that BNB plus 150,000,000 SAIL seed the PancakeSwap V3 pool and trading opens.",
    tokMktLive: "SAIL is live on PancakeSwap V3. Trade it directly, or read the live chart.",
    mktFundL: "Pool fund accumulated (70%)", mktRaisedL: "Total raised", mktStateL: "Status",
    mktPriceL: "Price (USD)", mktLiqL: "Liquidity (USD)", mktVolL: "24h volume (USD)",
    tokMktBtn1: "Trade on PancakeSwap", tokMktBtn2: "Open DexScreener",
    kRounds: "Sale Rounds", roundsTitle: "Five legs, five fish.",
    roundsSub: "Each round sails with its own mascot fish — the bigger the fish, the deeper the leg. 1 lot = 100,000 SAIL; max 10 paid lots per wallet per round. Prices are contract constants and can never change.",
    kTok: "Tokenomics", tokTitle: "1,000,000,000 total. Split once, in the open.",
    tokTeaserTitle: "1,000,000,000 total. Team: 0.", tokMore: "Full tokenomics →",
    tokSub: "Fixed supply, minted once at deployment, no further minting. Proceeds of every purchase are split on-chain the moment it happens.",
    alloc1: 'Sale rounds<span>5 rounds · 7,000 lots (1,000 free + 6,000 paid)</span>',
    alloc2: 'Liquidity pool<span>Paired with 70% of raised BNB</span>',
    alloc3: 'Ecosystem<span>Community & ecosystem building</span>',
    alloc4: 'Reserve<span>Project reserve</span>',
    split1: "of proceeds → liquidity pool", split2: "of proceeds → referrer (instant)", split3: "of proceeds → operations",
    split4: "of proceeds → reserve", split6: "team allocation",
    kSteps: "How to Join", stepsTitle: "Three steps aboard.",
    step1T: "Bring your Agent ID", step1D: "You need an Agent ID (.ai handle) inside Binance Agentic Wallet, plus a little BNB for gas. The free claim is only for Agent ID holders.",
    stepNo2: "02 / Connect", step2T: "Connect and claim / buy", step2D: "Connect your wallet on this site (BNB Smart Chain). In Round 1, claim your free lot first — or buy at the round price; then buy again as later rounds open.",
    stepNo3: "03 / Pool", step3T: "Trade freely once the pool opens", step3D: "The pool opens when the sale ends. Before that, SAIL is locked and non-transferable; after that it trades on PancakeSwap.",
    stepsMore: "Full guide →",
    kBuy: "Claim / Buy", buyTitle: "Get aboard.",
    buySub: "This site calls the contracts directly through your wallet. Every number is read live; buttons disable themselves while no round is open.",
    walletT: "My wallet", walletOffD: "Wallet not connected. Connect to see your claim eligibility, SAIL balance and purchases this round.",
    claimT: "Free claim · Round 1", claimD: "Every Agent ID can claim 1 free lot (100,000 SAIL); 1,000 slots in total. Enter your Agent ID handle to check eligibility:",
    handlePh: "e.g. yourhandle", checkId: "Check", claimBtn: "Claim 1 free lot",
    claimHint: "Claiming costs only gas — SAIL lands straight in your wallet.",
    mintT: "Buy this round", mRound: "Current round", mPrice: "Round price", mLeft: "Left this round", mMine: "My purchases (this round)",
    mLots: "Lots to buy (1 lot = 100,000 SAIL)", mRef: "Referrer address (optional)", refPh: "0x… referrer wallet address",
    mRefHint: "If filled, the referrer instantly receives 10% of your payment in BNB. Opening this site through a referral link fills it automatically.",
    mCost: "Total", mintBtn: "Buy", roundCardsT: "All rounds", myLotsT: "My purchases by round",
    myLotsOff: "Connect your wallet to see how many lots you bought in each round.",
    wAddr: "Address", wNet: "Network", wIds: "Agent IDs held",
    kRef: "Referral Program", refTitle: "Invite friends aboard, earn 10% instantly.",
    refSub: "When a friend buys SAIL through your link, your wallet address is passed as the referrer in their purchase — the contract pays you 10% of their payment in BNB inside the very same transaction. Fully on-chain.",
    refHowT: "Referrer requirements", req1: "Follow the official X account", req1Btn: "Follow @SailAgents",
    req2: "Like and retweet (RT) the pinned post", req3: "Post on X using the $SAIL ticker",
    req4: "Done — your referral link is active. Share it with friends.",
    reqNote: "Technical note: the contract pays the referrer address supplied at purchase instantly, with no off-chain review. The tasks above are this project's referral activation rules — complete them before promoting.",
    refLinkT: "My referral link", refLinkD: "Enter your wallet address (or connect your wallet) to generate your link. When friends open it and buy, you are filled in as their referrer automatically.",
    refAddrPh: "0x your wallet address", genRef: "Generate link", refLinkPh: "Your referral link appears here",
    copyBtn: "Copy", sharePh: "Your share text appears here", copyShare: "Copy share text",
    shareX: "Share to X", shareXNote: "Posting through this button covers the “post with $SAIL” step of the referrer activation tasks; following, liking and retweeting are still done manually on X.",
    shareSquare: "Share to Binance Square", shareSquareNote: "Sharing to Binance Square: this first copies the share text to your clipboard, then opens Binance Square — just paste it into the composer there.",
    refEarnT: "My referral earnings", refEarnNote: "Read live from the contract's ReferralPaid events (on-chain logs).",
    kHow: "Full Guide", howTitle: "From Agent ID to pool launch, in one pass.",
    how1T: "Get an Agent ID", how1D: "Create a Binance Agentic Wallet in the Binance App and register a .ai handle (3–15 chars, a-z and 0-9). No Agent ID, no free claim.",
    how2T: "Connect your wallet", how2D: "Tap “Connect wallet” at the top right and switch to BNB Smart Chain. Keep a little BNB in the wallet for gas and purchases.",
    how3T: "Claim free in Round 1", how3D: "Once Round 1 opens, enter your handle on the buy page, verify, and hit “Claim 1 free lot”. One claim per Agent ID, 1,000 slots total.",
    how4T: "Buy round by round", how4D: "Round 1 also sells paid lots (0.001 BNB / lot). Rounds 2–5 open in sequence at rising prices; max 10 lots per wallet per round.",
    how5T: "Invite and earn 10%", how5D: "Finish the follow / like / RT / post tasks, then share your referral link. Every purchase through it pays you 10% in BNB instantly.",
    how6T: "Pool launch & trading", how6D: "After Round 5, the pool opens: 70% of raised BNB + 150,000,000 SAIL, and transfers unlock at the same moment.",
    kFaq: "FAQ", faqTitle: "Quick answers.",
    faqQ1: "What do I need to take part?", faqA1: "A Binance Agentic Wallet with an Agent ID, connected on BNB Smart Chain. The free claim is for Agent ID holders only; paid purchases just need BNB.",
    faqQ2: "How does the free claim work?", faqA2: "Round 1 only: every Agent ID claims 1 free lot (100,000 SAIL), 1,000 lots in total. The contract checks that you personally own that Agent ID; each ID can claim once, ever.",
    faqQ3: "What are the prices and caps?", faqA3: "Round 1: 0.001 BNB (2,000 paid lots + 1,000 free). Round 2: 0.002 (1,500). Round 3: 0.003 (1,000). Round 4: 0.004 (800). Round 5: 0.005 (700). Max 10 lots per wallet per round. Prices and caps are contract constants — they cannot change.",
    faqQ4: "Why can't I transfer my SAIL?", faqA4: "Before the pool opens, SAIL is locked: only the sale contract can distribute it, and holders cannot transfer or trade it anywhere. That keeps the first price discovery inside the official pool. Launching the pool unlocks transfers permanently.",
    faqQ5: "How are referral rewards paid?", faqA5: "Your friend buys with your address as referrer (auto-filled via your link) and the contract sends you 10% of their payment in BNB in the same transaction — nothing to withdraw. With no referrer, that 10% goes to the reserve instead.",
    faqQ7: "Is it safe? Will you ask for my private key?", faqA7: "This site only issues standard contract calls through your browser wallet. We will never ask for a seed phrase or private key — anyone who does is a scammer. Contract addresses are authoritative only in this page's footer; double-check before acting.",
    faqQ8: "What is SAIL worth?", faqA8: "SailAgent is a community experiment token. No value, return or liquidity is promised; the price can go to zero. All rules live in the public contracts and on this page — assess the risk yourself.",
    kAgent: "Agent Guide", agentTitle: "Let your Agent do it for you.",
    agentSub: "No wallet connection needed here: copy one of the prompts below into your Binance Agent (Agentic Wallet) and it will run the on-chain calls for you. Every paid step must show you the exact BNB amount and wait for your confirmation.",
    agentFreeT: "Free claim only (spend no BNB)",
    agentBuyT: "Buy paid lots (your Agent must confirm the cost with you first)",
    agentPxT: "Mint SailPixels NFTs (first ship free in Phase 1)",
    agentPxText: "Help me mint SailPixels NFTs (SailAgent's pixel-ship NFT collection):\n1. Read-check the NFT contract 0x42bDFFf914afCF12047922AE58be397c1F351a27 on BNB Smart Chain (chainId 56): currentPhase() must be >= 1 and saleClosed() must be false. Then compute the exact total with mintCost(my wallet, quantity). In Phase 1 the first ship per wallet is free (mintCost already accounts for it); the rest cost the phase price: Phase 1 = 0.001 BNB per ship, Phases 2-5 = 0.002 / 0.003 / 0.004 / 0.005 BNB. Max 10 ships per wallet per phase.\n2. Show me the exact BNB total, clearly. If the total is > 0, execute ONLY after I explicitly confirm — never pay without my confirmation. If the total is 0 (free first ship only), still show me the preview first.\n3. Call mint(quantity) with value exactly equal to the mintCost result, gas limit 600000; preview with baw first.\n4. Afterwards send me the transaction hash and read rarityOf(new tokenId) to tell me which rarity I drew (it is revealed the moment the mint lands).",
    agentSkillT: "Install the SailAgent skill",
    agentSkillD: "One prompt installs the official SailAgent skill file into your Agent; after that it knows the contracts, the checks and the safety rules by heart.",
    agentFreeText: "Help me claim my free Round 1 lot of SailAgent (SAIL) — free claim only, do not buy anything:\n1. On BNB Smart Chain (chainId 56), confirm my wallet owns my Agent ID; agentId = uint256(keccak256(\"my handle, without the .ai suffix\")).\n2. Read-check the sale contract 0xD29A5c98ac9eee53d41A9561B3320832f7ECd6eA: currentRound() must be 1, freeClaimedByAgent(agentId) must be false, and ownerOf(agentId) on the registry 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F must equal my wallet.\n3. Preview claim(agentId) with baw first (value 0, gas limit 600000), show me the preview, and only execute after I confirm. Afterwards, send me the transaction hash.",
    agentBuyText: "Help me buy SailAgent (SAIL) — paid purchase, you must confirm the amount with me first:\n1. Read currentRound() and priceOf(current round) on the sale contract 0xD29A5c98ac9eee53d41A9561B3320832f7ECd6eA and compute the total = lots x round price (Round 1 is 0.001 BNB per lot). Show me that exact BNB total, clearly.\n2. The call is mint(lots, referrerWallet) — use the zero address 0x0000000000000000000000000000000000000000 when there is no referrer; value must equal the total exactly; gas limit 600000.\n3. Preview with baw, show me the exact amount, and execute ONLY after I explicitly confirm — never pay without my confirmation. Afterwards, send me the transaction hash.",
    skillPromptText: "Please fetch and install the official SailAgent skill file:\nhttps://sailagent.vercel.app/skill.md\nSave it as one of your skills, then follow it strictly to help me join SailAgent (free claim / paid purchase): preview every transaction first; before any payment, show me the exact BNB amount and wait for my confirmation; trust only the two official contract addresses written in skill.md.",
    kContracts: "Contract Addresses · BNB Smart Chain", cTokenN: "SAIL token", cSaleN: "Sale contract", cRegN: "Agent ID registry", cPxN: "SailPixels NFT", cPxMktN: "SailPixels market",
    footDisc: "Risk notice: SailAgent is a community experiment. Nothing here is investment advice; no token value, return or liquidity is promised. Read the contract source before joining, and trust addresses only from this official site.",
    kWp: "Whitepaper", wpTitle: "The SailAgent Whitepaper",
    wpSub: "This whitepaper sets out SailAgent's (SAIL) token rules, sale mechanics and pool-launch arrangement. Every number matches the contracts deployed on BNB Smart Chain; if anything differs, the contract code prevails.",
    wp1T: "1 · Overview",
    wp1D: "SailAgent (SAIL) is a community token themed on the ocean voyages of Zheng He's treasure fleet, made for Binance Agent ID holders. There is no team allocation: the full supply was minted once at deployment and most of it is distributed through five public sale rounds. Round 1 includes a free claim so Agent ID holders can come aboard at zero cost; the proceeds of every purchase are split on-chain at fixed ratios the moment it happens, with 70% accumulating as liquidity funding. After the fifth round, that funding and the reserved SAIL launch the pool on PancakeSwap V3.",
    wp2T: "2 · Token specification",
    wpSymL: "Symbol", wpSupL: "Total supply", wpDecL: "Decimals", wpMintL: "Minting", wpMintV: "Minted once at deployment — no further minting", wpChainL: "Network", wpTokL: "Token contract", wpSaleL: "Sale contract", wpVerL: "Source verification",
    wpLSrcT: "Sourcify · Token", wpLSrcS: "Sourcify · Sale", wpLScanT: "BscScan · Token", wpLScanS: "BscScan · Sale",
    wp3T: "3 · Allocation",
    wp3D: "The supply is split once, as follows. The liquidity reserve is held by the project until pool launch, when it enters the pool together with the accumulated BNB; unsold round lots move to the reserve.",
    wpA1L: "Sale rounds", wpA2L: "Liquidity reserve", wpA3L: "Ecosystem", wpA4L: "Reserve", wpA5L: "Team",
    wp4T: "4 · Sale rounds",
    wp4D: "1 lot = 100,000 SAIL. Each round closes when it sells out or 12 hours after it opens, whichever comes first; the project then opens the next round, and unsold lots move to the reserve. Round 1 also carries 1,000 free lots — every Agent ID can claim 1 free lot.",
    wpThR: "Round", wpThP: "Price (BNB / lot)", wpThPaid: "Paid lots", wpThFree: "Free lots",
    wpR1: "Round 1", wpR2: "Round 2", wpR3: "Round 3", wpR4: "Round 4", wpR5: "Round 5",
    wp4N: "Max 10 paid lots per wallet per round. Prices and caps are contract constants and cannot change after deployment.",
    wp5T: "5 · Split of proceeds",
    wp5D: "The BNB of every paid purchase is split in the same transaction at fixed ratios: 70% stays in the sale contract and accumulates as liquidity funding; 10% is paid to the referrer instantly; 5% goes to operations; 15% goes to the reserve. With no referrer, the referrer's 10% goes to the reserve instead.",
    wp6T: "6 · Referral rules",
    wp6D: "A referrer named at purchase receives 10% of the payment in BNB in the same transaction — fully verifiable on-chain. To become a referrer you first complete the official X tasks: follow @SailAgents, like and repost the pinned post, and publish a post containing $SAIL. The project verifies these tasks for real, one by one; only after verification does a referral link count. The Referrals page on this site generates your link and shares it in one tap.",
    wp7T: "7 · Pool launch & LP",
    wp7D: "After the five rounds end, the project launches the pool: the accumulated liquidity funding (70% of proceeds) together with the 150,000,000 SAIL liquidity reserve goes into a PancakeSwap V3 pool at the 1% fee tier. The LP position is held (locked) by the sale contract and can only be unlocked by the project owner. At the same moment, SAIL transfers and trading open.",
    wp8T: "8 · Transfer lock",
    wp8D: "Before the pool launches, SAIL is locked: holders cannot transfer it to each other or trade it on any market; tokens can only be distributed by the sale contract under the sale and claim rules. This keeps the first price discovery inside the official liquidity pool. Transaction details are governed by the contract code.",
    wp9T: "9 · Security & verification",
    wp9D: "Both contracts' source code is verified on Sourcify with an exact match — anyone can review it line by line. This site only issues standard contract calls through your browser wallet and will never ask for a seed phrase or private key — anyone who does is a scammer. Trust only the contract addresses published on this official site.",
    wp10T: "10 · Risk notice",
    wp10D: "SailAgent is a community experiment token. No value, return or liquidity is promised; the price can go to zero. This whitepaper and this site are not investment advice. Every rule lives in the public contracts — read the source and assess the risk yourself before joining."
  };

  var STR = {
    zh: {
      copied: "已复制", copyFail: "复制失败，请长按手动复制",
      badgeSoon: "即将开启", badgeLive: "进行中", badgeDone: "已结束", badgeSold: "售罄 SOLD OUT", badgeIdle: "未开始",
      fish: ["沙丁鱼", "鲣鱼", "金枪鱼", "马林鱼", "鲸鱼"],
      lotsUnit: "手", roundFmt: function (r) { return "第 " + r + " / 5 轮"; }, roundName: function (r) { return "第 " + r + " 轮"; },
      roundSoonBig: "第 1 轮 · 即将开启",
      heroSoon: "⏳ 第 1 轮即将开启 — 免费领取与首轮销售马上就来。",
      heroLive: function (r) { return "🔥 第 " + r + " 轮进行中 — 正在销售。"; },
      heroClosed: "销售已结束，等待开池。",
      heroLaunched: "⛵ 已开池 — SAIL 可以自由交易了。",
      saleLineFree: function (a, b) { return "免费已领 " + a + " / " + b + " 手"; },
      saleLinePaid: function (r, a, b) { return "第 " + r + " 轮付费已售 " + a + " / " + b + " 手"; },
      poolFundLine: function (v) { return "其中已锁定流动性资金 " + v + " BNB（70%）"; },
      updatedLine: function (tm) { return "最后更新 " + tm + " · 每 30 秒自动刷新"; },
      tradeLocked: "锁定中（开池后开启）", tradeOpen: "已开启",
      poolWait: "尚未开池。五轮销售结束并执行开池后，这里会显示池子地址。",
      poolOpen: function (a) { return "已开池：池子 " + a; },
      perLot: "/ 手", leftLots: function (n) { return "剩余 " + n + " 手"; },
      freeInRound: function (a, b) { return "另含免费领取 " + a + " / " + b + " 手"; },
      connected: function (a) { return "已连接 " + a; }, connect: "连接钱包",
      ctaClaim: "免费领取", ctaBuyRound: function (r) { return "第 " + r + " 轮 · 购买"; }, wrongNet: "网络不对 — 请切换到 BNB Smart Chain",
      noWallet: "未检测到钱包。请在币安 App 的 DApp 浏览器中打开本站（Agentic Wallet 在那里），或使用装有 Web3 钱包扩展的浏览器打开。",
      netOk: "BNB Smart Chain", netBad: "错误网络",
      chkInput: "先输入你的 Agent ID handle 再核对。", chkBad: "handle 格式不对：3–15 个字符，只含 a-z 与 0-9（可带 .ai 后缀）。",
      chkLoading: "正在链上核对…",
      chkOk: function (h) { return "✅ 资格确认：" + h + ".ai 由当前钱包持有，且尚未领取。可以点下方按钮免费领取。"; },
      chkOkNoWallet: function (h, o) { return "ℹ️ " + h + ".ai 的持有人是 " + o + "。请连接该钱包后再领取。"; },
      chkNotOwner: function (o) { return "❌ 这个 Agent ID 的持有人是 " + o + "，不是当前钱包。"; },
      chkAlready: "❌ 这个 Agent ID 已经领取过免费额度了。",
      chkFreeFull: "❌ 免费名额已领完（1,000 / 1,000）。",
      chkNotR1: "ℹ️ 免费领取只在第 1 轮开放。当前轮次未到或已过。",
      chkFail: "核对失败，请稍后再试。",
      claimSending: "⏳ 领取交易已发出，等待链上确认…", claimOk: "✅ 领取成功！100,000 SAIL 已到你的钱包。",
      claimFail: "领取失败或被拒绝。", txView: "在 BscScan 查看",
      mintNeedWallet: "先连接钱包再购买。", mintClosed: "当前没有开放中的轮次。",
      mintBadLots: "手数不对。", mintOverWallet: function (n) { return "本轮你最多还能买 " + n + " 手（每轮上限 10 手）。"; },
      mintOverRound: function (n) { return "本轮只剩 " + n + " 手了。"; },
      mintBadRef: "推荐人地址格式不对。", mintSelfRef: "推荐人不能填自己。",
      mintSending: "⏳ 购买交易已发出，等待链上确认…",
      mintOk: function (lots) { return "✅ 购买成功！" + lots + " 手 SAIL 已到你的钱包。"; },
      mintFail: "购买失败或被拒绝。",
      myLotsRow: function (r, lots) { return "第 " + r + " 轮"; },
      myLotsNone: "暂无购买记录",
      refFromLink: function (a) { return "🎉 你通过推荐链接打开本站，推荐人已自动填入：" + a; },
      refEarnLoading: "正在读取链上日志…", refEarnNone: "暂无推荐收益记录。",
      refEarnCount: function (n) { return "共 " + n + " 笔推荐购买"; },
      refEarnFail: "读取失败，请稍后再试。",
      shareText: function (link) { return "⛵ SailAgent $SAIL 扬帆启航！第 1 轮免费领取 1 手（100,000 SAIL），推荐立得 10% BNB。用我的链接登船：" + link; },
      genBadAddr: "请先输入有效的钱包地址，或连接钱包。",
      buyerShort: function (a) { return "买家 " + a; },
      boardLoading: "正在读取链上日志…",
      boardEmpty: "暂无数据 — 轮次开启后，领取与购买会出现在这里。",
      boardFail: "链上日志读取失败，稍后自动重试。",
      boardScanning: "正在同步链上日志…",
      actClaim: "免费领取", actBuy: "购买",
      justNow: "刚刚",
      agoMin: function (n) { return n + " 分钟前"; },
      agoHour: function (n) { return n + " 小时前"; },
      agoDay: function (n) { return n + " 天前"; },
      cdLabel: function (r) { return "第 " + r + " 轮剩余时间"; },
      cdNote: "本轮将在售罄或 12 小时到期时关闭。",
      cdEndsAt: function (tm) { return "预计关闭时间 " + tm; },
      campLine: function (a, b) { return "已分发 " + a + " / " + b + " 手"; },
      campFree: function (a) { return "其中免费领取 " + a + " 手"; },
      errRejected: "你在钱包里取消了这次请求。",
      errPending: "钱包里已有一个待确认的请求，请先去钱包里处理。",
      errNoChain: "未能切换到 BNB Smart Chain，请在钱包里手动切换后重试。",
      mktPreState: "未开池 — 等待五轮销售结束",
      mktLiveState: function (a) { return "已开池：池子 " + a; },
      mktFail: "行情读取失败，稍后再试。",
      squareCopied: "文案已复制 — 去币安广场粘贴发帖即可",
      pxPhaseFmt: function (r) { return "第 " + r + " / 5 期"; },
      pxNotOpen: "铸造尚未开启", pxClosed: "铸造已结束", pxPhaseFull: "本期已铸满",
      pxFreeUnused: "未使用（首艘免费）", pxFreeUsed: "已使用", pxFreeNA: "—（仅第 1 期）",
      pxSupplyL: "总量", pxPoolL: "奖池剩余",
      pxNoteNoWallet: "未连接钱包：按付费单价估算。第 1 期每钱包首艘免费，连接钱包后按合约 mintCost 实时计算确切金额。",
      pxNoteFree: "已包含第 1 期首艘免费；金额由合约 mintCost 实时计算。",
      pxNotePaid: "金额由合约 mintCost 实时计算，付款即铸造并揭晓稀有度。",
      pxOverCap: function (n) { return "本期最多还能铸造 " + n + " 艘（每钱包上限 / 本期剩余名额）。"; },
      pxMinting: "⏳ 铸造交易已发出，等待链上确认…",
      pxMintOk: function (n) { return "✅ 铸造成功！" + n + " 艘 SailPixels 已到你的钱包，稀有度已经揭晓。"; },
      pxMintFail: "铸造失败或被拒绝。",
      pxMktLoading: "正在读取挂单…", pxMktEmpty: "暂无挂单 — 来挂出第一艘吧。", pxMktFail: "挂单读取失败，稍后再试。",
      pxElemNote: "二级市场：SailPixels 也可在 Element Market（BNB 链）上交易。",
      pxElemBtn: "前往 Element Market 交易",
      pxSeller: function (a) { return "卖家 " + a; }, pxYours: "你的挂单",
      pxBuyBtn: "购买", pxCancelBtn: "取消挂单", pxListBtn: "上架",
      pxBuying: "⏳ 购买交易已发出，等待链上确认…", pxBuyOk: "✅ 购买成功！这艘 SailPixels 已到你的钱包。", pxBuyFail: "购买失败或被拒绝。",
      pxCanceling: "⏳ 取消交易已发出，等待链上确认…", pxCancelOk: "✅ 挂单已取消。", pxCancelFail: "取消失败或被拒绝。",
      pxUpdateBtn: "改价", pxUpdating: "⏳ 改价交易已发出，等待链上确认…", pxUpdateOk: "✅ 价格已更新。", pxUpdateFail: "改价失败或被拒绝。",
      pxNewPricePh: "新价格 BNB",
      pxMyOff: "连接钱包后，这里会显示你持有的 SailPixels。",
      pxMyPrompt: "点下方「扫描我的 NFT」，读取你持有的 SailPixels。",
      pxMyScanning: function (n) { return "正在扫描已铸造的 NFT（共 " + n + " 艘）…"; },
      pxMyEmpty: "你还没有 SailPixels — 先在上方铸造一艘吧。",
      pxMyCount: function (n) { return "共持有 " + n + " 艘"; },
      pxMyCapNote: function (n) { return "仅扫描了编号靠前的 " + n + " 艘已铸造 NFT；其余可用右侧表单按编号直接上架。"; },
      pxMyListingsT: "我的在售挂单",
      pxListedTag: function (p) { return "已上架 · " + p + " BNB"; },
      pxListChecking: "正在核对持有权与挂单状态…",
      pxApproveStep: "⏳ 先授权市场合约操作这艘 NFT…",
      pxListStep: "⏳ 正在上架…",
      pxListOk: "✅ 上架成功！",
      pxListFail: "上架失败或被拒绝。",
      pxBadToken: "请输入有效的 NFT 编号。",
      pxNotOwner: "这个编号不属于你的钱包。",
      pxBadPrice: function (m) { return "价格不合规：最低 " + m + " BNB。"; },
      pxAlreadyListed: "这个 NFT 已经在售了。"
    },
    en: {
      copied: "Copied", copyFail: "Copy failed — long-press to copy manually",
      badgeSoon: "Opening soon", badgeLive: "Live", badgeDone: "Ended", badgeSold: "SOLD OUT", badgeIdle: "Not started",
      fish: ["Anchovy", "Skipjack", "Tuna", "Marlin", "Whale"],
      lotsUnit: "lots", roundFmt: function (r) { return "Round " + r + " / 5"; }, roundName: function (r) { return "Round " + r; },
      roundSoonBig: "Round 1 · Opening soon",
      heroSoon: "⏳ Round 1 opens soon — the free claim and first sale are coming.",
      heroLive: function (r) { return "🔥 Round " + r + " is live now."; },
      heroClosed: "The sale has ended — waiting for the pool launch.",
      heroLaunched: "⛵ Pool is live — SAIL trades freely.",
      saleLineFree: function (a, b) { return "Free claimed " + a + " / " + b + " lots"; },
      saleLinePaid: function (r, a, b) { return "Round " + r + " paid sold " + a + " / " + b + " lots"; },
      poolFundLine: function (v) { return "Of which " + v + " BNB (70%) is locked as pool funding"; },
      updatedLine: function (tm) { return "Last updated " + tm + " · auto-refresh 30s"; },
      tradeLocked: "Locked (opens with the pool)", tradeOpen: "Open",
      poolWait: "Not launched yet. The pool address appears here after the five rounds end and launch is executed.",
      poolOpen: function (a) { return "Pool live: " + a; },
      perLot: "/ lot", leftLots: function (n) { return n + " lots left"; },
      freeInRound: function (a, b) { return "Plus free claims " + a + " / " + b + " lots"; },
      connected: function (a) { return "Connected " + a; }, connect: "Connect wallet",
      ctaClaim: "Claim Free", ctaBuyRound: function (r) { return "Round " + r + " · Buy"; }, wrongNet: "Wrong network — switch to BNB Smart Chain",
      noWallet: "No wallet detected. Open this page inside the Binance App's DApp browser (that is where the Agentic Wallet lives), or in a browser with a Web3 wallet extension.",
      netOk: "BNB Smart Chain", netBad: "Wrong network",
      chkInput: "Enter your Agent ID handle first, then check.", chkBad: "Invalid handle: 3–15 chars, a-z and 0-9 only (.ai suffix allowed).",
      chkLoading: "Checking on-chain…",
      chkOk: function (h) { return "✅ Eligible: " + h + ".ai is owned by your connected wallet and has not claimed yet. Use the button below."; },
      chkOkNoWallet: function (h, o) { return "ℹ️ " + h + ".ai is owned by " + o + ". Connect that wallet to claim."; },
      chkNotOwner: function (o) { return "❌ This Agent ID is owned by " + o + ", not by your wallet."; },
      chkAlready: "❌ This Agent ID has already claimed its free lot.",
      chkFreeFull: "❌ The free quota is gone (1,000 / 1,000).",
      chkNotR1: "ℹ️ The free claim is only open in Round 1.",
      chkFail: "Check failed — try again in a moment.",
      claimSending: "⏳ Claim sent — waiting for on-chain confirmation…", claimOk: "✅ Claimed! 100,000 SAIL is in your wallet.",
      claimFail: "Claim failed or was rejected.", txView: "View on BscScan",
      mintNeedWallet: "Connect your wallet first.", mintClosed: "No round is open right now.",
      mintBadLots: "Invalid lot count.", mintOverWallet: function (n) { return "You can buy at most " + n + " more lots this round (10 per round cap)."; },
      mintOverRound: function (n) { return "Only " + n + " lots are left this round."; },
      mintBadRef: "Invalid referrer address.", mintSelfRef: "You cannot refer yourself.",
      mintSending: "⏳ Purchase sent — waiting for on-chain confirmation…",
      mintOk: function (lots) { return "✅ Bought! " + lots + " lot(s) of SAIL are in your wallet."; },
      mintFail: "Purchase failed or was rejected.",
      myLotsRow: function (r, lots) { return "Round " + r; },
      myLotsNone: "No purchases yet",
      refFromLink: function (a) { return "🎉 You arrived via a referral link — referrer pre-filled: " + a; },
      refEarnLoading: "Reading on-chain logs…", refEarnNone: "No referral earnings yet.",
      refEarnCount: function (n) { return n + " referred purchase(s) in total"; },
      refEarnFail: "Read failed — try again later.",
      shareText: function (link) { return "⛵ SailAgent $SAIL has set sail! Round 1: claim 1 free lot (100,000 SAIL); referrers earn 10% in BNB. Board via my link: " + link; },
      genBadAddr: "Enter a valid wallet address first, or connect your wallet.",
      buyerShort: function (a) { return "Buyer " + a; },
      boardLoading: "Reading on-chain logs…",
      boardEmpty: "No data yet — claims and purchases appear here once a round opens.",
      boardFail: "Log read failed — retrying automatically.",
      boardScanning: "Syncing on-chain logs…",
      actClaim: "Free claim", actBuy: "Buy",
      justNow: "just now",
      agoMin: function (n) { return n + " min ago"; },
      agoHour: function (n) { return n + " h ago"; },
      agoDay: function (n) { return n + " d ago"; },
      cdLabel: function (r) { return "Round " + r + " time left"; },
      cdNote: "This round closes when it sells out or the 12-hour limit expires.",
      cdEndsAt: function (tm) { return "Closes around " + tm; },
      campLine: function (a, b) { return a + " / " + b + " lots distributed"; },
      campFree: function (a) { return a + " of them via free claims"; },
      errRejected: "You rejected the request in your wallet.",
      errPending: "A request is already pending in your wallet — handle it there first.",
      errNoChain: "Could not switch to BNB Smart Chain — switch manually in your wallet and retry.",
      mktPreState: "Not launched — waiting for the five rounds to end",
      mktLiveState: function (a) { return "Pool live: " + a; },
      mktFail: "Market data failed to load — try again shortly.",
      squareCopied: "Text copied — paste it into Binance Square to post",
      pxPhaseFmt: function (r) { return "Phase " + r + " / 5"; },
      pxNotOpen: "Minting is not open yet", pxClosed: "Minting has ended", pxPhaseFull: "This phase is fully minted",
      pxFreeUnused: "Available (first ship free)", pxFreeUsed: "Used", pxFreeNA: "— (Phase 1 only)",
      pxSupplyL: "Supply", pxPoolL: "Left in pool",
      pxNoteNoWallet: "No wallet connected: estimated at the paid unit price. In Phase 1 the first ship per wallet is free — connect a wallet and the contract's mintCost prices your exact total live.",
      pxNoteFree: "Includes your free first Phase-1 ship; priced live by the contract's mintCost.",
      pxNotePaid: "Priced live by the contract's mintCost. Paying mints and reveals the rarity at once.",
      pxOverCap: function (n) { return "You can mint at most " + n + " more this phase (per-wallet cap / phase supply left)."; },
      pxMinting: "⏳ Mint sent — waiting for on-chain confirmation…",
      pxMintOk: function (n) { return "✅ Minted! " + n + " SailPixels ship(s) are in your wallet, rarity revealed."; },
      pxMintFail: "Mint failed or was rejected.",
      pxMktLoading: "Loading listings…", pxMktEmpty: "No listings yet — list the first ship.", pxMktFail: "Could not load listings — try again shortly.",
      pxSeller: function (a) { return "Seller " + a; }, pxYours: "your listing",
      pxBuyBtn: "Buy", pxCancelBtn: "Cancel listing", pxListBtn: "List",
      pxBuying: "⏳ Purchase sent — waiting for on-chain confirmation…", pxBuyOk: "✅ Bought! That SailPixels ship is in your wallet now.", pxBuyFail: "Purchase failed or was rejected.",
      pxCanceling: "⏳ Cancel sent — waiting for on-chain confirmation…", pxCancelOk: "✅ Listing cancelled.", pxCancelFail: "Cancel failed or was rejected.",
      pxUpdateBtn: "Update", pxUpdating: "⏳ Update sent — waiting for on-chain confirmation…", pxUpdateOk: "✅ Price updated.", pxUpdateFail: "Price update failed or was rejected.",
      pxNewPricePh: "New price (BNB)",
      pxMyOff: "Connect your wallet to see your SailPixels here.",
      pxMyPrompt: "Tap “Scan my ships” below to load the SailPixels you own.",
      pxMyScanning: function (n) { return "Scanning minted ships (" + n + " in total)…"; },
      pxMyEmpty: "You don't own any SailPixels yet — mint one above.",
      pxMyCount: function (n) { return "You own " + n + " ship(s)"; },
      pxMyCapNote: function (n) { return "Only the first " + n + " minted ships were scanned; list any other by number with the form on the right."; },
      pxMyListingsT: "My active listings",
      pxListedTag: function (p) { return "Listed · " + p + " BNB"; },
      pxListChecking: "Checking ownership and listing state…",
      pxApproveStep: "⏳ Approving the market contract for this ship first…",
      pxListStep: "⏳ Listing…",
      pxListOk: "✅ Listed!",
      pxListFail: "Listing failed or was rejected.",
      pxBadToken: "Enter a valid token number.",
      pxNotOwner: "Your wallet does not own that token.",
      pxBadPrice: function (m) { return "Invalid price: the minimum is " + m + " BNB."; },
      pxAlreadyListed: "That ship is already listed."
    }
  };

  var lang = "zh";
  try { lang = localStorage.getItem("agentsail-lang") || "zh"; } catch (e) { }
  if (lang !== "en") lang = "zh";
  function t(k) { return STR[lang][k]; }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function isAddr(a) { return typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a); }
  function shortAddr(a) { return a ? a.slice(0, 6) + "…" + a.slice(-4) : "—"; }

  var toastTimer = null;
  function toast(msg) {
    var el = $("toast"); if (!el) return;
    el.textContent = msg; el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 2400);
  }
  function copyText(text, okMsg) {
    function done() { toast(okMsg || t("copied")); }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { toast(t("copyFail")); }
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  /* i18n: ZH lives in the HTML; capture originals, swap to EN dict on toggle. */
  var originals = [], originalsPh = [];
  function captureI18n() {
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      originals.push({ el: el, html: el.innerHTML });
    });
    document.querySelectorAll("[data-i18n-ph]").forEach(function (el) {
      originalsPh.push({ el: el, ph: el.getAttribute("placeholder") || "" });
    });
  }
  function applyLang(next, skipSave) {
    lang = next === "en" ? "en" : "zh";
    if (!skipSave) { try { localStorage.setItem("agentsail-lang", lang); } catch (e) { } }
    document.documentElement.lang = lang === "en" ? "en" : "zh-CN";
    originals.forEach(function (o) {
      var k = o.el.getAttribute("data-i18n");
      if (lang === "en" && EN[k] != null) o.el.innerHTML = EN[k];
      else o.el.innerHTML = o.html;
    });
    originalsPh.forEach(function (o) {
      var k = o.el.getAttribute("data-i18n-ph");
      if (lang === "en" && EN[k] != null) o.el.setAttribute("placeholder", EN[k]);
      else o.el.setAttribute("placeholder", o.ph);
    });
    var lz = $("langZh"), le = $("langEn");
    if (lz) lz.classList.toggle("active", lang === "zh");
    if (le) le.classList.toggle("active", lang === "en");
    refreshDynamic();
  }

  /* ================= formatters ================= */
  function fmtNum(v) { // BigInt | number → full grouped digits, never compact units
    var s = v.toString();
    var neg = s.charAt(0) === "-"; if (neg) s = s.slice(1);
    var out = "";
    while (s.length > 3) { out = "," + s.slice(-3) + out; s = s.slice(0, -3); }
    return (neg ? "-" : "") + s + out;
  }
  function fmtToken(wei) { // 18-dec, full grouped whole part; fraction only if non-zero
    var w = BigInt(wei), neg = w < 0n; if (neg) w = -w;
    var whole = w / 1000000000000000000n, rem = w % 1000000000000000000n;
    var s = fmtNum(whole);
    if (rem > 0n) {
      var fs = rem.toString().padStart(18, "0").replace(/0+$/, "");
      s += "." + (fs.length > 6 ? fs.slice(0, 6) : fs);
    }
    return (neg ? "-" : "") + s;
  }
  function fmtBNB(wei) {
    var w = BigInt(wei);
    var whole = w / 1000000000000000000n, rem = w % 1000000000000000000n;
    if (rem === 0n) return whole.toString();
    var fs = rem.toString().padStart(18, "0").replace(/0+$/, "");
    return whole.toString() + "." + fs;
  }
  function nowTime() {
    try { return new Date().toLocaleTimeString(lang === "en" ? "en-GB" : "zh-CN", { hour12: false }); }
    catch (e) { return new Date().toLocaleTimeString(); }
  }

  /* ================= keccak-256 (handle → Agent ID tokenId) ================= */
  var KRC = [
    0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
    0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
    0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
    0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
    0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
    0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n
  ];
  var KRHO = [
    [0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61], [28, 55, 25, 21, 56], [27, 20, 39, 8, 14]
  ];
  function rotl(x, n) { if (n === 0) return x; var b = BigInt(n); return ((x << b) | (x >> (64n - b))) & 0xffffffffffffffffn; }
  function keccakF(s) {
    for (var round = 0; round < 24; round++) {
      var C = [], D = [], B = new Array(25).fill(0n);
      for (var x = 0; x < 5; x++) C[x] = s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20];
      for (x = 0; x < 5; x++) D[x] = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
      for (var y = 0; y < 5; y++) for (x = 0; x < 5; x++) s[x + 5 * y] ^= D[x];
      for (y = 0; y < 5; y++) for (x = 0; x < 5; x++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], KRHO[x][y]);
      for (y = 0; y < 5; y++) for (x = 0; x < 5; x++) s[x + 5 * y] = B[x + 5 * y] ^ ((~B[(x + 1) % 5 + 5 * y]) & B[(x + 2) % 5 + 5 * y]);
      s[0] ^= KRC[round];
    }
  }
  function keccak256(bytes) {
    var rate = 136, s = new Array(25).fill(0n);
    var padded = bytes.slice();
    padded.push(0x01);
    while (padded.length % rate !== rate - 1) padded.push(0);
    padded.push(0x80);
    for (var off = 0; off < padded.length; off += rate) {
      for (var i = 0; i < rate; i++) {
        var lane = (i / 8) | 0, sh = BigInt((i % 8) * 8);
        s[lane] ^= BigInt(padded[off + i]) << sh;
      }
      keccakF(s);
    }
    var out = [];
    for (var j = 0; j < 32; j++) out.push(Number((s[(j / 8) | 0] >> BigInt((j % 8) * 8)) & 0xffn));
    return out;
  }
  function agentIdFromHandle(raw) {
    var h = String(raw || "").trim().toLowerCase().replace(/\.ai$/, "").replace(/^@/, "");
    if (!/^[a-z0-9]{3,15}$/.test(h)) return null;
    var bytes = [];
    for (var i = 0; i < h.length; i++) bytes.push(h.charCodeAt(i)); // regex above guarantees ASCII
    var hex = keccak256(bytes).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    return { handle: h, id: BigInt("0x" + hex), idEnc: hex.padStart(64, "0") };
  }

  /* ================= raw JSON-RPC with rotation ================= */
  var rpcIdx = 0;
  function rpcJSON(rpcs, payload) {
    var tries = [];
    for (var i = 0; i < rpcs.length; i++) tries.push(rpcs[(rpcIdx + i) % rpcs.length]);
    function attempt(k) {
      if (k >= tries.length) return Promise.reject(new Error("all RPCs failed"));
      return fetch(tries[k], {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
      }).then(function (r) { return r.json(); }).then(function (j) {
        if (j.error) throw new Error(j.error.message || "rpc error");
        rpcIdx = (rpcIdx + k) % rpcs.length;
        return j.result;
      }).catch(function () { return attempt(k + 1); });
    }
    return attempt(0);
  }
  function ethCall(to, data) {
    return rpcJSON(RPCS, { jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: to, data: data }, "latest"] });
  }
  function rpcCall(method, params) {
    return rpcJSON(RPCS, { jsonrpc: "2.0", id: 1, method: method, params: params });
  }
  function u256(hex) { return (!hex || hex === "0x") ? 0n : BigInt(hex); }
  function addrFromWord(hex) { return "0x" + String(hex || "").slice(-40); }
  function encUint(v) { return BigInt(v).toString(16).padStart(64, "0"); }
  function encAddr(a) { return a.toLowerCase().replace(/^0x/, "").padStart(64, "0"); }
  function callUint(to, sel) { return ethCall(to, sel).then(u256); }

  /* SailPixels selectors: computed from the ABI function signatures with
     the keccak256 above — never hand-typed. (selOf("balanceOf(address)")
     reproduces SEL.balanceOf, which is how the derivation is sanity-checked.) */
  function selOf(sig) {
    var bytes = [];
    for (var i = 0; i < sig.length; i++) bytes.push(sig.charCodeAt(i) & 0xff);
    return "0x" + keccak256(bytes).slice(0, 4).map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
  }
  var PSEL = {
    pxCurrentPhase: selOf("currentPhase()"), pxPhaseMinted: selOf("phaseMinted(uint256)"),
    pxTotalMinted: selOf("totalMinted()"), pxPool: selOf("poolRemaining(uint256)"),
    pxFreeUsed: selOf("freeUsed(address)"), pxMintCost: selOf("mintCost(address,uint256)"),
    pxPriceOf: selOf("priceOf(uint256)"), pxMintedInPhase: selOf("mintedInPhase(uint256,address)"),
    pxMaxPer: selOf("MAX_PER_WALLET_PHASE()"), pxPhaseSize: selOf("PHASE_SIZE()"),
    pxMaxSupply: selOf("MAX_SUPPLY()"), pxSaleClosed: selOf("saleClosed()"),
    pxMint: selOf("mint(uint256)"), pxRarityOf: selOf("rarityOf(uint256)"),
    pxBalanceOf: selOf("balanceOf(address)"), pxOwnerOf: selOf("ownerOf(uint256)"),
    pxGetApproved: selOf("getApproved(uint256)"), pxIsApprovedForAll: selOf("isApprovedForAll(address,address)"),
    pxSetApprovalForAll: selOf("setApprovalForAll(address,bool)"),
    mkListings: selOf("listings(uint256)"), mkActiveIds: selOf("activeIds(uint256)"),
    mkActiveCount: selOf("activeCount()"), mkIsBuyable: selOf("isBuyable(uint256)"),
    mkListingOfToken: selOf("listingOfToken(uint256)"), mkMinPrice: selOf("MIN_PRICE()"),
    mkList: selOf("list(uint256,uint256)"), mkBuy: selOf("buy(uint256)"),
    mkCancel: selOf("cancel(uint256)"), mkUpdatePrice: selOf("updatePrice(uint256,uint256)")
  };
  /* word i of an eth_call result, as BigInt / as address (word 0 of the
     market's listings() tuple carries the seller in its low 20 bytes) */
  function wordAt(hex, i) { var s = String(hex || "").replace(/^0x/, ""); var w = s.slice(i * 64, i * 64 + 64); return w ? BigInt("0x" + w) : 0n; }
  function addrAt(hex, i) { var s = String(hex || "").replace(/^0x/, ""); var w = s.slice(i * 64, i * 64 + 64); return "0x" + w.slice(-40); }
  function parseBnb(str) { // "0.001" → wei BigInt; null when malformed
    var m = String(str || "").trim().match(/^(\d+)(?:\.(\d{1,18}))?$/);
    if (!m) return null;
    return BigInt(m[1]) * 1000000000000000000n + BigInt((m[2] || "").padEnd(18, "0") || "0");
  }

  /* ================= SVG art: treasure ship + fish mascots ================= */
  function shipSvg() {
    return '' +
    '<svg viewBox="0 0 460 330" role="img" aria-label="Treasure ship 宝船" style="width:100%;height:auto;display:block">' +
    '<ellipse cx="230" cy="302" rx="205" ry="15" fill="#062c4c"/>' +
    '<path d="M26 292 Q 90 268 150 290 T 280 290 T 430 288" stroke="#37c8e8" stroke-width="3" fill="none" opacity="0.65"/>' +
    '<path d="M60 304 Q 140 284 220 302 T 420 300" stroke="#1282c9" stroke-width="3" fill="none" opacity="0.5"/>' +
    '<g stroke="#8a5a2b" stroke-width="3" stroke-linecap="round"><line x1="185" y1="238" x2="185" y2="52"/><line x1="300" y1="238" x2="300" y2="86"/></g>' +
    '<path d="M185 58 L300 210 L185 210 Z" fill="#f4fbff"/>' +
    '<path d="M192 66 L286 204 L192 204 Z" fill="#bfeaff" opacity="0.55"/>' +
    '<path d="M300 92 L382 210 L300 210 Z" fill="#e8f7ff"/>' +
    '<path d="M178 76 L92 210 L178 210 Z" fill="#dff4ff"/>' +
    '<path d="M185 52 L172 66 L198 66 Z" fill="#ffb703"/>' +
    '<path d="M300 86 L290 98 L312 98 Z" fill="#ffb703"/>' +
    '<path d="M96 224 L372 224 L336 266 Q230 288 132 266 Z" fill="#8a5a2b"/>' +
    '<path d="M96 224 L372 224 L362 240 L108 240 Z" fill="#6f4520"/>' +
    '<rect x="196" y="200" width="66" height="24" rx="4" fill="#a9713a"/>' +
    '<rect x="222" y="188" width="16" height="14" rx="3" fill="#7c4f24"/>' +
    '<circle cx="150" cy="246" r="5" fill="#ffd166"/><circle cx="205" cy="252" r="5" fill="#ffd166"/><circle cx="262" cy="252" r="5" fill="#ffd166"/><circle cx="316" cy="246" r="5" fill="#ffd166"/>' +
    '<g fill="#37c8e8" opacity="0.85"><path d="M60 268 q7 -9 14 0 q-7 4 -14 0Z"/><path d="M392 262 q7 -9 14 0 q-7 4 -14 0Z"/></g>' +
    '</svg>';
  }
  function fishSvg(kind) {
    var body = {
      anchovy: '<g fill="#a8d8ea"><path d="M14 46 Q52 22 96 46 Q52 68 14 46Z"/><path d="M94 46 L124 28 L118 46 L124 62 Z"/><circle cx="34" cy="43" r="4" fill="#062544"/></g><path d="M46 34 Q60 46 46 57" stroke="#7fb8d4" stroke-width="2.5" fill="none"/>',
      skipjack: '<g fill="#5db9e8"><path d="M8 46 Q56 14 104 46 Q56 76 8 46Z"/><path d="M102 46 L132 26 L124 46 L132 64 Z"/></g><path d="M22 58 Q56 70 96 58" stroke="#2c7fb8" stroke-width="3" fill="none"/><path d="M30 62 Q58 72 90 62" stroke="#2c7fb8" stroke-width="3" fill="none"/><path d="M58 22 L70 12 L74 24 Z" fill="#2c7fb8"/><circle cx="30" cy="42" r="4.5" fill="#062544"/>',
      tuna: '<g fill="#3f8fd2"><path d="M6 46 Q58 10 110 46 Q58 80 6 46Z"/><path d="M108 46 L138 24 L128 46 L138 66 Z"/></g><path d="M62 18 L76 4 L82 20 Z" fill="#2c6ea8"/><path d="M66 74 L78 88 L84 72 Z" fill="#2c6ea8"/><path d="M14 52 Q58 64 104 52" stroke="#ffd166" stroke-width="3" fill="none" opacity="0.8"/><circle cx="30" cy="42" r="5" fill="#062544"/>',
      marlin: '<g fill="#2b6cb0"><path d="M44 46 Q84 16 122 46 Q84 72 44 46Z"/><path d="M120 46 L142 30 L136 46 L142 60 Z"/><path d="M44 46 L2 40 L40 50 Z" fill="#2b6cb0"/><path d="M84 22 L96 6 L102 24 Z" fill="#1d4e89"/><path d="M88 70 L98 86 L104 68 Z" fill="#1d4e89"/></g><circle cx="58" cy="43" r="4" fill="#062544"/>',
      whale: '<g fill="#4a7fb5"><path d="M10 50 Q16 22 62 20 Q112 22 126 44 Q112 70 58 70 Q20 68 10 50Z"/><path d="M124 40 L146 24 L144 44 L148 60 L126 52 Z"/></g><path d="M30 66 Q62 76 100 66" stroke="#d9f6ff" stroke-width="3" fill="none" opacity="0.65"/><circle cx="34" cy="44" r="4.5" fill="#062544"/><g stroke="#9fd8ef" stroke-width="2.5" fill="none" stroke-linecap="round"><path d="M66 16 q-3 -8 -10 -10"/><path d="M74 14 q0 -9 -6 -13"/><path d="M82 16 q3 -8 10 -10"/></g>'
    };
    return '<svg viewBox="0 0 150 92" role="img" aria-label="fish">' + (body[kind] || body.anchovy) + '</svg>';
  }
  var FISH_KEYS = ["anchovy", "skipjack", "tuna", "marlin", "whale"];

  /* ================= live state ================= */
  var live = null, liveAt = 0;
  function loadLive() {
    var S = CONFIG.SALE;
    var jobs = [
      callUint(S, SEL.currentRound).catch(function () { return -1n; }),
      ethCall(S, SEL.saleClosed).then(function (h) { return u256(h) !== 0n; }).catch(function () { return false; }),
      ethCall(S, SEL.launched).then(function (h) { return u256(h) !== 0n; }).catch(function () { return false; }),
      callUint(S, SEL.freeSold).catch(function () { return 0n; }),
      callUint(S, SEL.totalRaised).catch(function () { return 0n; }),
      callUint(S, SEL.poolFund).catch(function () { return 0n; }),
      ethCall(S, SEL.pool).then(addrFromWord).catch(function () { return null; }),
      callUint(CONFIG.TOKEN, SEL.balanceOf + encAddr(S)).catch(function () { return 0n; }),
      ethCall(CONFIG.TOKEN, SEL.tradingOpen).then(function (h) { return u256(h) !== 0n; }).catch(function () { return false; })
    ];
    for (var r = 1; r <= 5; r++) {
      (function (rr) {
        jobs.push(callUint(S, SEL.priceOf + encUint(rr)).catch(function () { return SPEC[rr - 1].price; }));
        jobs.push(callUint(S, SEL.paidCapOf + encUint(rr)).catch(function () { return SPEC[rr - 1].cap; }));
        jobs.push(callUint(S, SEL.paidSold + encUint(rr)).catch(function () { return 0n; }));
      })(r);
    }
    return Promise.all(jobs).then(function (v) {
      var rounds = [];
      for (var i = 0; i < 5; i++) rounds.push({ price: v[9 + i * 3], cap: v[10 + i * 3], sold: v[11 + i * 3] });
      live = {
        round: v[0] < 0n ? 0 : Number(v[0]), closed: v[1], launched: v[2],
        freeSold: v[3], totalRaised: v[4], poolFund: v[5], poolAddr: v[6],
        saleBal: v[7], tradingOpen: v[8], rounds: rounds
      };
      liveAt = Date.now();
      renderLive();
      refreshActions();
      loadMyStatus();
      scanBoard(false);
      if (curPage === "pixels") { pxLoad(); pxLoadMarket(); }
    }).catch(function () { /* keep last good state */ });
  }

  function roundState(r) {
    if (!live) return "idle";
    var rd = live.rounds[r - 1];
    if (rd && rd.sold >= rd.cap && r === live.round && !live.launched) return "sold";
    if (live.launched || live.closed) return r <= Math.max(live.round, 1) ? "done" : "idle";
    if (live.round === 0) return "idle";
    if (r < live.round) return "done";
    if (r === live.round) return "live";
    return "idle";
  }
  function roundCardHTML(r) {
    var rd = live ? live.rounds[r - 1] : { price: SPEC[r - 1].price, cap: SPEC[r - 1].cap, sold: 0n };
    var st = roundState(r);
    var badgeCls = st === "live" ? "live" : st === "sold" ? "sold" : st === "done" ? "done" : (r === 1 && live && live.round === 0 && !live.closed ? "soon" : "idle");
    var badgeTxt = st === "live" ? t("badgeLive") : st === "sold" ? t("badgeSold") : st === "done" ? t("badgeDone") : (r === 1 && live && live.round === 0 && !live.closed ? t("badgeSoon") : t("badgeIdle"));
    // Progress bar: Round 1 counts free claims + paid lots against the
    // combined 3,000-lot round total; other rounds are paid-only.
    var isR1 = r === 1 && !!live;
    var totalLots = isR1 ? rd.cap + CONFIG.FREE_CAP : rd.cap;
    var doneLots = isR1 ? rd.sold + live.freeSold : rd.sold;
    var pct = totalLots > 0n ? Number(doneLots * 10000n / totalLots) / 100 : 0;
    var left = rd.cap > rd.sold ? rd.cap - rd.sold : 0n;
    var extra = r === 1 && live ? '<p class="hint">' + esc(t("freeInRound")(fmtNum(live.freeSold), fmtNum(CONFIG.FREE_CAP))) + "</p>" : "";
    return '<div class="card round-card' + (st === "live" ? " current" : "") + (st === "sold" ? " soldout" : "") + '">' +
      '<div class="fish">' + fishSvg(FISH_KEYS[r - 1]) + "</div>" +
      "<h3>" + esc(t("roundName")(r)) + " · " + esc(t("fish")[r - 1]) + ' <span class="badge ' + badgeCls + '">' + esc(badgeTxt) + "</span></h3>" +
      '<div class="rprice">' + fmtBNB(rd.price) + " BNB <small>" + esc(t("perLot")) + " · 100,000 SAIL</small></div>" +
      '<div class="progress"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
      "<p>" + esc(t("saleLinePaid")(r, fmtNum(rd.sold), fmtNum(rd.cap))) + " · " + esc(t("leftLots")(fmtNum(left))) + "</p>" +
      extra + "</div>";
  }
  function renderRoundCards() {
    var html = "";
    for (var r = 1; r <= 5; r++) html += roundCardHTML(r);
    var a = $("homeRoundCards"), b = $("buyRoundCards");
    if (a) a.innerHTML = html;
    if (b) b.innerHTML = html;
  }
  function renderLive() {
    if (!live) return;
    renderHeaderCta();
    renderRoundCards();
    // hero status
    var hs = $("heroStatus");
    if (live.launched) hs.textContent = t("heroLaunched");
    else if (live.closed) hs.textContent = t("heroClosed");
    else if (live.round === 0) hs.textContent = t("heroSoon");
    else hs.textContent = t("heroLive")(live.round);
    // home live cards
    var st = liveStateBadge();
    $("saleBadge").className = "badge " + st.cls; $("saleBadge").textContent = st.txt;
    var cbadge = $("claimBadge");
    if (cbadge) {
      var freeGone = live.freeSold >= CONFIG.FREE_CAP;
      var claimLive = live.round === 1 && !live.closed && !live.launched && !freeGone;
      if (freeGone) { cbadge.className = "badge sold"; cbadge.textContent = t("badgeSold"); }
      else if (claimLive) { cbadge.className = "badge live"; cbadge.textContent = t("badgeLive"); }
      else if (live.round === 0 && !live.closed && !live.launched) {
        cbadge.className = "badge " + st.cls;
        cbadge.textContent = st.txt;
      }
      else { cbadge.className = "badge done"; cbadge.textContent = t("badgeDone"); }
    }
    var mbadge = $("mintBadge");
    if (mbadge) { mbadge.className = "badge " + st.cls; mbadge.textContent = st.txt; }
    $("saleRound").textContent = live.round === 0 && !live.closed && !live.launched ? t("roundSoonBig") : t("roundFmt")(Math.max(live.round, 1));
    var cur = live.rounds[Math.max(live.round, 1) - 1];
    $("saleLine1").textContent = t("saleLineFree")(fmtNum(live.freeSold), fmtNum(CONFIG.FREE_CAP));
    $("saleLine2").textContent = live.round === 0 ? t("poolFundLine")(fmtBNB(live.poolFund)) : t("saleLinePaid")(live.round, fmtNum(cur.sold), fmtNum(cur.cap));
    $("liveUpdated").textContent = t("updatedLine")(nowTime());
    $("freeNum").textContent = fmtNum(live.freeSold);
    $("freeBar").style.width = (Number(live.freeSold * 10000n / CONFIG.FREE_CAP) / 100).toFixed(1) + "%";
    $("raisedNum").textContent = fmtBNB(live.totalRaised);
    $("poolFundLine").textContent = t("poolFundLine")(fmtBNB(live.poolFund));
    $("balSale").textContent = fmtToken(live.saleBal) + " SAIL";
    $("balTrade").textContent = live.tradingOpen ? t("tradeOpen") : t("tradeLocked");
    $("poolState").textContent = live.launched && live.poolAddr ? t("poolOpen")(shortAddr(live.poolAddr)) : t("poolWait");
    // buy page current-round panel
    var cr = Math.max(live.round, 1);
    $("mRound").textContent = live.round === 0 ? t("roundSoonBig") : t("roundFmt")(live.round);
    $("mPrice").textContent = fmtBNB(live.rounds[cr - 1].price) + " BNB";
    var left = live.rounds[cr - 1].cap - live.rounds[cr - 1].sold;
    $("mLeft").textContent = fmtNum(left > 0n ? left : 0n) + " " + t("lotsUnit");
    updateMintCost();
    renderMyLots();
    renderCampaign();
    updateCountdownCard();
    renderMarket();
  }
  function renderCampaign() {
    var numEl = $("campNum"), barEl = $("campBar"), lineEl = $("campLine");
    if (!numEl || !live) return;
    var paid = 0n;
    live.rounds.forEach(function (rd) { paid += rd.sold; });
    var dist = paid + live.freeSold;
    var total = 7000n;
    numEl.textContent = fmtNum(dist);
    if (barEl) barEl.style.width = (Number(dist * 10000n / total) / 100).toFixed(1) + "%";
    if (lineEl) lineEl.textContent = t("campLine")(fmtNum(dist), fmtNum(total)) + " · " + (Number(dist * 10000n / total) / 100).toFixed(1) + "% · " + t("campFree")(fmtNum(live.freeSold));
  }
  function liveStateBadge() {
    if (live.launched) return { cls: "live", txt: t("badgeLive") };
    if (live.closed) return { cls: "done", txt: t("badgeDone") };
    if (live.round === 0) return { cls: "soon", txt: t("badgeSoon") };
    var cur = live.rounds[live.round - 1];
    if (cur && cur.sold >= cur.cap) return { cls: "done", txt: t("badgeSold") };
    return { cls: "live", txt: t("badgeLive") };
  }

  /* ================= wallet ================= */
  var account = null, chainOk = false, myLots = [0n, 0n, 0n, 0n, 0n], mySail = null, myIds = null, myBnb = null;
  function currentRefParam() { try { return localStorage.getItem("agentsail-ref"); } catch (e) { return null; } }
  var claimCheck = null; // {handle, idEnc, owner, already}

  /* Provider detection: the Binance App DApp browser (Agentic Wallet) and
     Web3 wallet extensions inject a standard EIP-1193 provider as
     window.ethereum; some builds expose several via .providers (pick a
     Binance one first). The legacy Binance Chain wallet is a last resort. */
  var provider = null;
  function getProvider() {
    if (provider) return provider;
    if (typeof window === "undefined") return null;
    var eth = window.ethereum;
    if (eth && Array.isArray(eth.providers) && eth.providers.length) {
      provider = eth.providers.filter(function (p) { return p && p.isBinance; })[0] ||
        eth.providers.filter(function (p) { return p && p.isMetaMask; })[0] || eth.providers[0];
    } else if (eth && typeof eth.request === "function") {
      provider = eth;
    } else if (window.BinanceChain && typeof window.BinanceChain.request === "function") {
      provider = window.BinanceChain;
    }
    return provider;
  }
  function provReq(method, params) {
    var p = getProvider();
    if (!p) return Promise.reject(new Error("no wallet"));
    return p.request({ method: method, params: params || [] });
  }
  function walletErrMsg(e) {
    if (e && e.code === 4001) return t("errRejected");
    if (e && e.code === -32002) return t("errPending");
    return null;
  }
  function setSessionWallet(on) {
    try { if (on) sessionStorage.setItem("agentsail-wallet", "1"); else sessionStorage.removeItem("agentsail-wallet"); } catch (e) { }
  }
  function sessionWalletWanted() {
    try { return sessionStorage.getItem("agentsail-wallet") === "1"; } catch (e) { return false; }
  }
  function refreshConnectBtn() {
    // The header no longer carries a wallet button (its CTA is pure
    // navigation); the connect flow + address display live on the Buy page.
    var b = $("connectBtn2"); if (!b) return;
    b.textContent = account ? t("connected")(shortAddr(account)) : t("connect");
    b.classList.toggle("btn-ghost", !!account);
    b.classList.toggle("btn-primary", !account);
  }
  /* Header CTA: pure navigation to the Buy page's claim card. Its label
     follows the polled chain state — Claim Free while Round 1's free quota
     lasts (or before any round opens); once the free quota is gone or a
     later round is running it points at the live round's buy panel. It
     never connects a wallet itself. */
  function renderHeaderCta() {
    var cta = $("headerCta"); if (!cta) return;
    var buyRound = 0;
    if (live) {
      var freeGone = live.freeSold >= CONFIG.FREE_CAP;
      if (live.round >= 2 || (live.round === 1 && freeGone)) buyRound = live.round;
    }
    cta.textContent = buyRound ? t("ctaBuyRound")(buyRound) : t("ctaClaim");
  }
  function connectWallet() {
    if (!getProvider()) { toast(t("noWallet")); return; }
    provReq("eth_requestAccounts").then(function (accs) {
      account = accs && accs[0] ? accs[0] : null;
      if (account) setSessionWallet(true);
      return ensureChain();
    }).then(function (ok) {
      if (account && !ok) toast(t("errNoChain"));
      refreshConnectBtn(); renderWalletCard(); loadMyStatus();
      if (claimCheck) renderClaimCheck();
      refreshActions();
    }).catch(function (e) {
      toast(walletErrMsg(e) || t("noWallet"));
    });
  }
  function resetWalletState() {
    account = null; chainOk = false;
    myLots = [0n, 0n, 0n, 0n, 0n]; mySail = null; myIds = null; myBnb = null;
    claimCheck = null;
    var co = $("claimOut"); if (co) { co.textContent = ""; co.className = ""; }
    setSessionWallet(false);
    refreshConnectBtn(); renderWalletCard(); refreshActions();
  }
  function ensureChain() {
    return provReq("eth_chainId").then(function (cid) {
      chainOk = parseInt(cid, 16) === CONFIG.CHAIN_ID;
      if (chainOk) return true;
      return provReq("wallet_switchEthereumChain", [{ chainId: "0x38" }]).then(function () {
        return provReq("eth_chainId").then(function (c2) { chainOk = parseInt(c2, 16) === CONFIG.CHAIN_ID; return chainOk; });
      }).catch(function (e) {
        if (e && e.code === 4902) {
          return provReq("wallet_addEthereumChain", [{ chainId: "0x38", chainName: "BNB Smart Chain", nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 }, rpcUrls: ["https://bsc-dataseed.binance.org"], blockExplorerUrls: ["https://bscscan.com"] }]).then(function () { chainOk = true; return true; }).catch(function () { return false; });
        }
        return false;
      });
    }).catch(function () { chainOk = false; return false; });
  }
  function renderWalletCard() {
    var on = $("walletOn"), off = $("walletOff");
    if (!account) { on.style.display = "none"; off.style.display = "block"; $("myLotsList").innerHTML = '<li><span>' + (lang === "en" ? EN.myLotsOff : "连接钱包后显示你每一轮已购买的手数。") + '</span><b>—</b></li>'; return; }
    off.style.display = "none"; on.style.display = "block";
    $("wAddr").textContent = shortAddr(account);
    $("wNet").textContent = chainOk ? t("netOk") : t("netBad");
    $("wSail").textContent = mySail === null ? "…" : fmtToken(mySail) + " SAIL";
    $("wBnb").textContent = myBnb === null ? "…" : fmtBNB(myBnb) + " BNB";
    $("wIds").textContent = myIds === null ? "…" : String(myIds);
    var rn = $("wRefNote"), rp = currentRefParam();
    if (rn) {
      if (rp && isAddr(rp)) { rn.style.display = "block"; rn.textContent = t("refFromLink")(shortAddr(rp)); }
      else rn.style.display = "none";
    }
  }
  function loadMyStatus() {
    if (!account) { renderWalletCard(); return; }
    var S = CONFIG.SALE;
    var jobs = [
      callUint(CONFIG.TOKEN, SEL.balanceOf + encAddr(account)).catch(function () { return null; }),
      callUint(CONFIG.REGISTRY, SEL.balanceOf + encAddr(account)).catch(function () { return null; }),
      rpcCall("eth_getBalance", [account, "latest"]).then(u256).catch(function () { return null; })
    ];
    for (var r = 1; r <= 5; r++) (function (rr) {
      jobs.push(callUint(S, SEL.paidLotsOf + encUint(rr) + encAddr(account)).catch(function () { return 0n; }));
    })(r);
    Promise.all(jobs).then(function (v) {
      mySail = v[0]; myIds = v[1] === null ? null : Number(v[1]); myBnb = v[2];
      for (var i = 0; i < 5; i++) myLots[i] = v[3 + i];
      renderWalletCard(); renderMyLots(); refreshActions(); updateMintCost();
    }).catch(function () { });
  }
  function renderMyLots() {
    var el = $("myLotsList"); if (!el) return;
    if (!account) return;
    var cur = live ? Math.max(live.round, 1) : 1;
    $("mMine").textContent = fmtNum(myLots[cur - 1]) + " / 10 " + t("lotsUnit");
    var rows = "", any = false;
    for (var r = 1; r <= 5; r++) {
      if (myLots[r - 1] > 0n) { any = true; rows += "<li><span>" + esc(t("roundName")(r)) + " · " + esc(t("fish")[r - 1]) + "</span><b>" + fmtNum(myLots[r - 1]) + " " + esc(t("lotsUnit")) + " · " + fmtToken(myLots[r - 1] * CONFIG.LOT_TOKENS * 1000000000000000000n) + " SAIL</b></li>"; }
    }
    el.innerHTML = any ? rows : '<li><span>' + esc(t("myLotsNone")) + '</span><b>—</b></li>';
  }

  /* ================= claim check + claim ================= */
  function checkClaim() {
    var out = $("claimOut");
    var parsed = agentIdFromHandle($("handleInput").value);
    if (!parsed) { out.textContent = t("chkBad"); out.className = "hint msg-bad"; claimCheck = null; refreshActions(); return; }
    claimCheck = null; refreshActions();
    out.textContent = t("chkLoading"); out.className = "hint";
    var ownerP = ethCall(CONFIG.REGISTRY, SEL.ownerOf + parsed.idEnc).then(addrFromWord).catch(function () { return null; });
    var claimedP = ethCall(CONFIG.SALE, SEL.freeClaimed + parsed.idEnc).then(function (h) { return u256(h) !== 0n; }).catch(function () { return false; });
    Promise.all([ownerP, claimedP]).then(function (v) {
      // re-validate: the input may have changed while reading
      var now = agentIdFromHandle($("handleInput").value);
      if (!now || now.idEnc !== parsed.idEnc) return;
      claimCheck = { handle: parsed.handle, idEnc: parsed.idEnc, owner: v[0], already: v[1] };
      renderClaimCheck();
      refreshActions();
    }).catch(function () { out.textContent = t("chkFail"); out.className = "hint msg-bad"; });
  }
  function renderClaimCheck() {
    if (!claimCheck) return;
    var out = $("claimOut"), c = claimCheck;
    if (!c.owner) { out.textContent = t("chkFail"); out.className = "hint msg-bad"; return; }
    if (c.already) { out.textContent = t("chkAlready"); out.className = "hint msg-bad"; return; }
    if (live && live.freeSold >= CONFIG.FREE_CAP) { out.textContent = t("chkFreeFull"); out.className = "hint msg-bad"; return; }
    if (!live || live.round !== 1) { out.textContent = t("chkNotR1"); out.className = "hint msg-wait"; return; }
    if (account && c.owner.toLowerCase() !== account.toLowerCase()) {
      out.textContent = t("chkNotOwner")(shortAddr(c.owner)); out.className = "hint msg-bad"; return;
    }
    if (!account) { out.textContent = t("chkOkNoWallet")(c.handle, shortAddr(c.owner)); out.className = "hint"; return; }
    out.textContent = t("chkOk")(c.handle); out.className = "hint msg-ok";
  }
  function claimReady() {
    return !!(account && chainOk && live && live.round === 1 && !live.closed && !live.launched &&
      claimCheck && claimCheck.owner && !claimCheck.already &&
      claimCheck.owner.toLowerCase() === account.toLowerCase() && live.freeSold < CONFIG.FREE_CAP);
  }
  function doClaim() {
    if (!claimReady()) return;
    var out = $("claimOut");
    out.textContent = t("claimSending"); out.className = "hint msg-wait";
    $("claimBtn").disabled = true;
    sendTx(CONFIG.SALE, SEL.claim + claimCheck.idEnc, 0n).then(function (hash) {
      out.innerHTML = esc(t("claimOk")) + ' <a class="tx-link" target="_blank" rel="noopener" href="https://bscscan.com/tx/' + hash + '">' + esc(t("txView")) + "</a>";
      out.className = "hint msg-ok";
      claimCheck.already = true;
      loadLive();
    }).catch(function (e) {
      out.textContent = t("claimFail") + (e && e.message ? " (" + String(e.message).slice(0, 80) + ")" : "");
      out.className = "hint msg-bad";
      refreshActions();
    });
  }

  /* ================= mint ================= */
  function parseLots() {
    var v = parseInt($("lotInput").value, 10);
    return isNaN(v) ? 0 : v;
  }
  function mintProblem() {
    if (!live || live.round < 1 || live.closed || live.launched) return t("mintClosed");
    var lots = parseLots();
    if (lots < 1) return t("mintBadLots");
    if (!account) return t("mintNeedWallet");
    var cur = live.round, rd = live.rounds[cur - 1];
    var mine = myLots[cur - 1];
    if (BigInt(lots) + mine > CONFIG.MAX_LOTS) return t("mintOverWallet")(fmtNum(CONFIG.MAX_LOTS - mine));
    var left = rd.cap - rd.sold;
    if (BigInt(lots) > left) return t("mintOverRound")(fmtNum(left > 0n ? left : 0n));
    var ref = $("refInput").value.trim();
    if (ref) {
      if (!isAddr(ref)) return t("mintBadRef");
      if (account && ref.toLowerCase() === account.toLowerCase()) return t("mintSelfRef");
    }
    return null;
  }
  function updateMintCost() {
    if (!live) return;
    var cr = Math.max(live.round, 1);
    var lots = Math.max(parseLots(), 0);
    var cost = live.rounds[cr - 1].price * BigInt(lots);
    $("mCost").textContent = fmtBNB(cost) + " BNB · " + fmtToken(BigInt(lots) * CONFIG.LOT_TOKENS * 1000000000000000000n) + " SAIL";
    var btn = $("mintBtn");
    if (btn && btn.childNodes[0]) btn.childNodes[0].textContent = (lang === "en" ? EN.mintBtn : "购买");
  }
  function refreshActions() {
    var cb = $("claimBtn"), mb = $("mintBtn");
    if (cb) cb.disabled = !claimReady();
    if (mb) mb.disabled = !!mintProblem();
    updateMintCost();
    pxSyncWallet();
  }
  function doMint() {
    var prob = mintProblem();
    var out = $("mintOut");
    if (prob) { out.textContent = prob; out.className = "hint msg-bad"; return; }
    if (!chainOk) { toast(t("wrongNet")); ensureChain().then(function () { refreshActions(); }); return; }
    var lots = parseLots();
    var ref = $("refInput").value.trim();
    var refAddr = isAddr(ref) ? ref : "0x0000000000000000000000000000000000000000";
    var cost = live.rounds[live.round - 1].price * BigInt(lots);
    out.textContent = t("mintSending"); out.className = "hint msg-wait";
    $("mintBtn").disabled = true;
    sendTx(CONFIG.SALE, SEL.mint + encUint(lots) + encAddr(refAddr), cost).then(function (hash) {
      out.innerHTML = esc(t("mintOk")(lots)) + ' <a class="tx-link" target="_blank" rel="noopener" href="https://bscscan.com/tx/' + hash + '">' + esc(t("txView")) + "</a>";
      out.className = "hint msg-ok";
      loadLive();
    }).catch(function (e) {
      out.textContent = t("mintFail") + (e && e.message ? " (" + String(e.message).slice(0, 80) + ")" : "");
      out.className = "hint msg-bad";
      refreshActions();
    });
  }
  function sendTx(to, data, valueWei) {
    return provReq("eth_sendTransaction", [{ from: account, to: to, data: data, value: "0x" + valueWei.toString(16) }]).then(function (hash) {
      return waitReceipt(hash).then(function () { return hash; });
    });
  }
  function waitReceipt(hash) {
    var tries = 0;
    function poll() {
      tries++;
      return provReq("eth_getTransactionReceipt", [hash]).then(function (rc) {
        if (rc) {
          if (rc.status === "0x1") return rc;
          throw new Error("tx reverted");
        }
        if (tries > 50) throw new Error("timeout");
        return new Promise(function (res) { setTimeout(res, 3000); }).then(poll);
      });
    }
    return poll();
  }

  /* ================= SailPixels: mint + gallery =================
     NFT 0x42bD…1a27 (phases of 1,111, gacha rarity from a shrinking pool,
     phase-1 first ship free per wallet) + market 0xF648…EC81 (non-custodial,
     10% fee, 0.001 BNB minimum list). All reads go through the same rotating
     RPC helper; writes reuse sendTx/waitReceipt from the SAIL buy flow. */
  var PX_RAR = [
    { slug: "common", en: "Common", zh: "普通", shipEn: "Anchovy Fisher", shipZh: "凤尾鱼渔船", supply: 2777n, color: "#9aa7b4" },
    { slug: "uncommon", en: "Uncommon", zh: "非凡", shipEn: "Shrimp Sloop", shipZh: "小虾帆船", supply: 1667n, color: "#efe6cf" },
    { slug: "epic", en: "Epic", zh: "史诗", shipEn: "Crab Warship", shipZh: "螃蟹战舰", supply: 667n, color: "#b07fe8" },
    { slug: "legend", en: "Legend", zh: "传奇", shipEn: "Golden Marlin", shipZh: "金色旗鱼号", supply: 333n, color: "#ffa53b" },
    { slug: "mythic", en: "Mythic", zh: "神话", shipEn: "Dragon Whale Baochuan", shipZh: "龙鲸宝船", supply: 111n, color: "#e5484d" }
  ];
  function pxRarName(i) { return lang === "en" ? PX_RAR[i].en : PX_RAR[i].zh; }
  var px = { loaded: false, phase: 0, closed: false, phaseMinted: 0n, totalMinted: 0n, phaseSize: 1111n, maxSupply: 5555n, maxPer: 10n, price: 0n, pool: [null, null, null, null, null], minPrice: 1000000000000000n };
  var pxW = { addr: null, minted: 0n, freeUsed: false, balance: 0n, owned: null, scanning: false, scannedTotal: 0n, scannedCap: 0 };
  var pxMkt = { loaded: false, loading: false, rows: [] };
  var pxRarCache = {};
  var PX_SCAN_CAP = 600;

  function pxLoad() {
    var N = CONFIG.PIXELS;
    var jobs = [
      callUint(N, PSEL.pxCurrentPhase).catch(function () { return null; }),
      ethCall(N, PSEL.pxSaleClosed).then(function (h) { return u256(h) !== 0n; }).catch(function () { return false; }),
      callUint(N, PSEL.pxTotalMinted).catch(function () { return null; }),
      callUint(N, PSEL.pxPhaseSize).catch(function () { return 1111n; }),
      callUint(N, PSEL.pxMaxSupply).catch(function () { return 5555n; }),
      callUint(N, PSEL.pxMaxPer).catch(function () { return 10n; }),
      callUint(CONFIG.PIXELS_MKT, PSEL.mkMinPrice).catch(function () { return 1000000000000000n; })
    ];
    for (var i = 0; i < 5; i++) (function (k) {
      jobs.push(callUint(N, PSEL.pxPool + encUint(k)).catch(function () { return null; }));
    })(i);
    return Promise.all(jobs).then(function (v) {
      if (v[0] === null || v[2] === null) { pxRenderAll(); return undefined; }
      px.phase = Number(v[0]); px.closed = v[1]; px.totalMinted = v[2];
      if (v[3]) px.phaseSize = v[3];
      if (v[4]) px.maxSupply = v[4];
      if (v[5]) px.maxPer = v[5];
      if (v[6]) px.minPrice = v[6];
      for (var k = 0; k < 5; k++) px.pool[k] = v[7 + k];
      px.loaded = true;
      var extra = [];
      if (px.phase >= 1) {
        extra.push(callUint(N, PSEL.pxPhaseMinted + encUint(px.phase)).then(function (x) { px.phaseMinted = x; }).catch(function () { }));
        extra.push(callUint(N, PSEL.pxPriceOf + encUint(px.phase)).then(function (x) { px.price = x; }).catch(function () { }));
      } else { px.phaseMinted = 0n; px.price = 0n; }
      return Promise.all(extra).then(function () { pxRenderAll(); pxWalletLoad(); });
    }).catch(function () { pxRenderAll(); });
  }
  function pxWalletLoad() {
    if (!account) { pxW.addr = null; pxRenderMint(); pxRenderMine(); return; }
    if (pxW.addr !== account) { pxW.minted = 0n; pxW.freeUsed = false; pxW.balance = 0n; pxW.owned = null; }
    var N = CONFIG.PIXELS, a = account;
    var jobs = [callUint(N, PSEL.pxBalanceOf + encAddr(a)).catch(function () { return null; })];
    if (px.phase >= 1) {
      jobs.push(callUint(N, PSEL.pxMintedInPhase + encUint(px.phase) + encAddr(a)).catch(function () { return null; }));
      jobs.push(ethCall(N, PSEL.pxFreeUsed + encAddr(a)).then(function (h) { return u256(h) !== 0n; }).catch(function () { return false; }));
    }
    Promise.all(jobs).then(function (v) {
      if (account !== a) return; // wallet changed while reading
      pxW.addr = a;
      if (v[0] !== null) pxW.balance = v[0];
      if (px.phase >= 1) { if (v[1] !== null) pxW.minted = v[1]; pxW.freeUsed = !!v[2]; }
      pxRenderMint();
      pxRenderMine();
    }).catch(function () { });
  }
  function pxSyncWallet() {
    if (account !== pxW.addr) pxWalletLoad();
    else { pxRenderMint(); pxRenderMine(); }
  }
  function pxParseQty() { var el = $("pxQtyInput"); var v = el ? parseInt(el.value, 10) : 0; return isNaN(v) ? 0 : v; }
  function pxMaxQty() {
    var cap = 10;
    if (px.loaded) {
      cap = Number(px.maxPer);
      if (account && pxW.addr === account) cap = Math.min(cap, Math.max(Number(px.maxPer - pxW.minted), 0));
      cap = Math.min(cap, Math.max(Number(px.phaseSize - px.phaseMinted), 0));
    }
    return Math.max(cap, 0);
  }
  function pxMintProblem() {
    if (!px.loaded) return t("pxNotOpen");
    if (px.closed) return t("pxClosed");
    if (px.phase < 1) return t("pxNotOpen");
    if (px.phaseMinted >= px.phaseSize) return t("pxPhaseFull");
    if (pxParseQty() < 1) return t("mintBadLots");
    if (!account) return t("mintNeedWallet");
    if (pxParseQty() > pxMaxQty()) return t("pxOverCap")(pxMaxQty());
    return null;
  }
  var pxCostSeq = 0;
  function pxUpdateCost() {
    var costEl = $("pxCost"), noteEl = $("pxCostNote"), btn = $("pxMintBtn");
    if (!costEl) return;
    if (btn) btn.disabled = !!pxMintProblem();
    var qty = pxParseQty();
    if (!px.loaded || px.phase < 1 || px.closed || qty < 1) { costEl.textContent = "—"; if (noteEl) noteEl.textContent = ""; return; }
    if (!account) {
      costEl.textContent = fmtBNB(px.price * BigInt(qty)) + " BNB";
      if (noteEl) noteEl.textContent = t("pxNoteNoWallet");
      return;
    }
    var seq = ++pxCostSeq, a = account;
    ethCall(CONFIG.PIXELS, PSEL.pxMintCost + encAddr(a) + encUint(qty)).then(function (h) {
      if (seq !== pxCostSeq || account !== a) return;
      var cost = u256(h);
      costEl.textContent = fmtBNB(cost) + " BNB";
      if (noteEl) noteEl.textContent = (px.phase === 1 && !pxW.freeUsed && cost < px.price * BigInt(qty)) ? t("pxNoteFree") : t("pxNotePaid");
    }).catch(function () { if (seq === pxCostSeq) costEl.textContent = "—"; });
  }
  function doPxMint() {
    var out = $("pxMintOut");
    var prob = pxMintProblem();
    if (prob) { out.textContent = prob; out.className = "hint msg-bad"; return; }
    if (!chainOk) { toast(t("wrongNet")); ensureChain().then(function () { pxUpdateCost(); }); return; }
    var qty = pxParseQty(), a = account;
    out.textContent = t("pxMinting"); out.className = "hint msg-wait";
    $("pxMintBtn").disabled = true;
    // price it fresh from mintCost, then send exactly that value
    ethCall(CONFIG.PIXELS, PSEL.pxMintCost + encAddr(a) + encUint(qty)).then(function (h) {
      return sendTx(CONFIG.PIXELS, PSEL.pxMint + encUint(qty), u256(h));
    }).then(function (hash) {
      out.innerHTML = esc(t("pxMintOk")(qty)) + ' <a class="tx-link" target="_blank" rel="noopener" href="https://bscscan.com/tx/' + hash + '">' + esc(t("txView")) + "</a>";
      out.className = "hint msg-ok";
      pxW.owned = null;
      pxLoad(); pxLoadMarket();
    }).catch(function (e) {
      out.textContent = t("pxMintFail") + (e && e.message ? " (" + String(e.message).slice(0, 80) + ")" : "");
      out.className = "hint msg-bad";
      pxUpdateCost();
    });
  }
  function pxRenderAll() { pxRenderChips(); pxRenderGallery(); pxRenderMint(); pxRenderListings(); pxRenderMine(); }
  function pxRenderChips() {
    var el = $("pxChips"); if (!el) return;
    el.innerHTML = PX_RAR.map(function (r, i) {
      return '<span class="px-chip" style="border-color:' + r.color + ";color:" + r.color + '">' + esc(pxRarName(i)) + " · " + fmtNum(r.supply) + "</span>";
    }).join("");
  }
  function pxRenderGallery() {
    var el = $("pxGallery"); if (!el) return;
    el.innerHTML = PX_RAR.map(function (r, i) {
      var pool = px.pool[i];
      return '<div class="card px-rar">' +
        '<img src="sailpixels/' + r.slug + '.png" alt="' + esc(r.shipEn) + '" loading="lazy">' +
        '<h3><span class="px-dot" style="background:' + r.color + '"></span>' + esc(pxRarName(i)) + (lang === "en" ? "" : " · " + esc(r.en)) + "</h3>" +
        '<p class="px-ship">' + esc(r.shipEn) + " · " + esc(r.shipZh) + "</p>" +
        '<ul class="pools">' +
        "<li><span>" + esc(t("pxSupplyL")) + "</span><b>" + fmtNum(r.supply) + "</b></li>" +
        "<li><span>" + esc(t("pxPoolL")) + "</span><b>" + (pool === null ? "…" : fmtNum(pool)) + "</b></li>" +
        "</ul></div>";
    }).join("");
  }
  function pxRenderMint() {
    var badge = $("pxMintBadge"); if (!badge) return;
    if (!px.loaded) { badge.className = "badge soon"; badge.textContent = "…"; }
    else if (px.closed) { badge.className = "badge done"; badge.textContent = t("badgeDone"); }
    else if (px.phase >= 1) {
      var full = px.phaseMinted >= px.phaseSize;
      badge.className = "badge " + (full ? "done" : "live");
      badge.textContent = full ? t("pxPhaseFull") : t("badgeLive");
    } else { badge.className = "badge soon"; badge.textContent = t("badgeSoon"); }
    $("pxPhase").textContent = px.loaded ? (px.phase >= 1 ? t("pxPhaseFmt")(px.phase) : t("pxNotOpen")) : "—";
    $("pxPhaseMinted").textContent = px.loaded && px.phase >= 1 ? fmtNum(px.phaseMinted) + " / " + fmtNum(px.phaseSize) : "—";
    $("pxTotal").textContent = px.loaded ? fmtNum(px.totalMinted) + " / " + fmtNum(px.maxSupply) : "—";
    $("pxPrice").textContent = px.loaded && px.phase >= 1 ? fmtBNB(px.price) + " BNB" : "—";
    $("pxMine").textContent = !account ? "—" : (px.phase >= 1 && pxW.addr === account ? fmtNum(pxW.minted) + " / " + fmtNum(px.maxPer) : "—");
    $("pxFree").textContent = !account ? "—" : (px.phase === 1 && pxW.addr === account ? (pxW.freeUsed ? t("pxFreeUsed") : t("pxFreeUnused")) : (px.phase > 1 ? t("pxFreeNA") : "—"));
    var bar = $("pxPhaseBar");
    if (bar) bar.style.width = px.loaded && px.phase >= 1 && px.phaseSize > 0n ? (Number(px.phaseMinted * 10000n / px.phaseSize) / 100).toFixed(1) + "%" : "0%";
    var lb = $("pxLiveBadge");
    if (lb) {
      lb.className = badge.className; lb.textContent = badge.textContent;
      var dot = $("pxLiveDot");
      if (dot) dot.style.background = (px.loaded && px.phase >= 1 && !px.closed && px.phaseMinted < px.phaseSize) ? "#2ecc71" : "#7d838d";
      $("pxLivePhase").textContent = $("pxPhase").textContent;
      $("pxLiveMinted").textContent = $("pxPhaseMinted").textContent;
      $("pxLivePrice").textContent = $("pxPrice").textContent;
    }
    pxUpdateCost();
  }

  /* ================= SailPixels: market ================= */
  function pxRarityOf(id) {
    if (pxRarCache[id] != null) return Promise.resolve(pxRarCache[id]);
    return callUint(CONFIG.PIXELS, PSEL.pxRarityOf + encUint(id)).then(function (v) { pxRarCache[id] = Number(v); return pxRarCache[id]; }).catch(function () { return 0; });
  }
  function pxLoadMarket() {
    var grid = $("pxListings"); if (!grid || pxMkt.loading) return;
    pxMkt.loading = true;
    if (!pxMkt.loaded) grid.innerHTML = '<p class="hint">' + esc(t("pxMktLoading")) + "</p>";
    var M = CONFIG.PIXELS_MKT;
    callUint(M, PSEL.mkActiveCount).then(function (n) {
      var idxs = [];
      for (var i = 0; i < Number(n); i++) idxs.push(i);
      return Promise.all(idxs.map(function (i) {
        return callUint(M, PSEL.mkActiveIds + encUint(i)).catch(function () { return null; });
      })).then(function (idVals) {
        var jobs = idVals.filter(function (x) { return x !== null; }).map(function (id) {
          return ethCall(M, PSEL.mkListings + encUint(id)).then(function (h) {
            var row = { id: Number(id), seller: addrAt(h, 0), tokenId: Number(wordAt(h, 1)), price: wordAt(h, 2), rarity: 0 };
            return pxRarityOf(row.tokenId).then(function (r) { row.rarity = r; return row; });
          }).catch(function () { return null; });
        });
        return Promise.all(jobs);
      });
    }).then(function (rows) {
      pxMkt.rows = (rows || []).filter(function (r) { return !!r; });
      pxMkt.loaded = true; pxMkt.loading = false;
      pxRenderListings();
    }).catch(function () {
      pxMkt.loading = false;
      if (!pxMkt.loaded) grid.innerHTML = '<p class="hint msg-bad">' + esc(t("pxMktFail")) + "</p>";
    });
  }
  function pxRenderListings() {
    var grid = $("pxListings"); if (!grid) return;
    if (!pxMkt.loaded) return; // pxLoadMarket paints the loading / failure states
    if (!pxMkt.rows.length) { grid.innerHTML = '<p class="hint">' + esc(t("pxMktEmpty")) + "</p>"; return; }
    grid.innerHTML = pxMkt.rows.map(function (row) {
      var r = PX_RAR[row.rarity] || PX_RAR[0];
      var mine = !!account && row.seller.toLowerCase() === account.toLowerCase();
      var btn = mine
        ? '<button class="btn btn-ghost small" type="button" data-pxact="cancel" data-id="' + row.id + '">' + esc(t("pxCancelBtn")) + "</button>"
        : '<button class="btn btn-primary small" type="button" data-pxact="buy" data-id="' + row.id + '"' + (account ? "" : " disabled") + ">" + esc(t("pxBuyBtn")) + "</button>";
      return '<div class="px-lst">' +
        '<img src="sailpixels/' + r.slug + '.png" alt="' + esc(r.shipEn) + '" loading="lazy">' +
        '<div class="px-lst-name"><span class="px-dot" style="background:' + r.color + '"></span>' + esc(pxRarName(row.rarity)) + " · #" + row.tokenId + "</div>" +
        '<div class="px-lst-ship">' + esc(r.shipEn) + " · " + esc(r.shipZh) + "</div>" +
        '<div class="px-price">' + fmtBNB(row.price) + " BNB</div>" +
        '<div class="px-seller">' + esc(t("pxSeller")(shortAddr(row.seller))) + (mine ? " · " + esc(t("pxYours")) : "") + "</div>" +
        '<div class="px-lst-act">' + btn + "</div></div>";
    }).join("");
  }
  function pxNote(html, cls) {
    var note = $("pxMktNote2"); if (!note) return;
    if (cls) note.className = "hint " + cls;
    if (html != null) note.innerHTML = html;
  }
  function pxTxLink(hash) {
    return ' <a class="tx-link" target="_blank" rel="noopener" href="https://bscscan.com/tx/' + hash + '">' + esc(t("txView")) + "</a>";
  }
  function pxDoBuy(id) {
    if (!account) { toast(t("mintNeedWallet")); return; }
    if (!chainOk) { toast(t("wrongNet")); ensureChain(); return; }
    var M = CONFIG.PIXELS_MKT;
    pxNote(esc(t("pxBuying")), "msg-wait");
    // re-read the listing + buyable flag so the value sent is never stale
    ethCall(M, PSEL.mkListings + encUint(id)).then(function (h) {
      var price = wordAt(h, 2);
      return callUint(M, PSEL.mkIsBuyable + encUint(id)).then(function (b) {
        if (b === 0n) throw new Error("listing not buyable");
        return sendTx(M, PSEL.mkBuy + encUint(id), price);
      });
    }).then(function (hash) {
      pxNote(esc(t("pxBuyOk")) + pxTxLink(hash), "msg-ok");
      pxW.owned = null;
      pxLoadMarket(); pxWalletLoad();
    }).catch(function (e) {
      pxNote(esc(t("pxBuyFail")) + (e && e.message ? " (" + esc(String(e.message).slice(0, 80)) + ")" : ""), "msg-bad");
      pxLoadMarket();
    });
  }
  function pxDoCancel(id) {
    if (!account) { toast(t("mintNeedWallet")); return; }
    if (!chainOk) { toast(t("wrongNet")); ensureChain(); return; }
    pxNote(esc(t("pxCanceling")), "msg-wait");
    sendTx(CONFIG.PIXELS_MKT, PSEL.mkCancel + encUint(id), 0n).then(function (hash) {
      pxNote(esc(t("pxCancelOk")) + pxTxLink(hash), "msg-ok");
      pxW.owned = null;
      pxRenderMine(); pxLoadMarket();
    }).catch(function (e) {
      pxNote(esc(t("pxCancelFail")) + (e && e.message ? " (" + esc(String(e.message).slice(0, 80)) + ")" : ""), "msg-bad");
    });
  }
  function pxDoUpdate(id) {
    var inp = $("pxUpd-" + id);
    var price = inp ? parseBnb(inp.value) : null;
    if (price === null || price < px.minPrice) { toast(t("pxBadPrice")(fmtBNB(px.minPrice))); return; }
    if (!account) { toast(t("mintNeedWallet")); return; }
    if (!chainOk) { toast(t("wrongNet")); ensureChain(); return; }
    pxNote(esc(t("pxUpdating")), "msg-wait");
    sendTx(CONFIG.PIXELS_MKT, PSEL.mkUpdatePrice + encUint(id) + encUint(price), 0n).then(function (hash) {
      pxNote(esc(t("pxUpdateOk")) + pxTxLink(hash), "msg-ok");
      pxW.owned = null;
      pxRenderMine(); pxLoadMarket();
    }).catch(function (e) {
      pxNote(esc(t("pxUpdateFail")) + (e && e.message ? " (" + esc(String(e.message).slice(0, 80)) + ")" : ""), "msg-bad");
    });
  }

  /* ================= SailPixels: my ships + listing ================= */
  function pxScanMine() {
    if (!account || pxW.scanning) return;
    var N = CONFIG.PIXELS, M = CONFIG.PIXELS_MKT, a = account;
    pxW.scanning = true;
    pxRenderMine();
    callUint(N, PSEL.pxTotalMinted).then(function (total) {
      pxW.scannedTotal = total;
      var cap = Math.min(Number(total), PX_SCAN_CAP);
      pxW.scannedCap = cap;
      var ownedIds = [], pos = 0;
      function batch() {
        if (account !== a) return Promise.resolve();
        var slice = [];
        for (var i = pos; i < Math.min(pos + 40, cap); i++) slice.push(i + 1);
        pos += slice.length;
        if (!slice.length) return Promise.resolve();
        return Promise.all(slice.map(function (id) {
          return ethCall(N, PSEL.pxOwnerOf + encUint(id)).then(function (h) { return { id: id, owner: addrFromWord(h) }; }).catch(function () { return null; });
        })).then(function (rs) {
          rs.forEach(function (r) { if (r && r.owner.toLowerCase() === a.toLowerCase()) ownedIds.push(r.id); });
          return batch();
        });
      }
      return batch().then(function () {
        if (account !== a) return [];
        return Promise.all(ownedIds.map(function (id) {
          return pxRarityOf(id).then(function (rar) {
            return callUint(M, PSEL.mkListingOfToken + encUint(id)).then(function (lid) {
              var o = { id: id, rarity: rar, listingId: Number(lid), price: 0n };
              if (!o.listingId) return o;
              return ethCall(M, PSEL.mkListings + encUint(lid)).then(function (h) {
                if (addrAt(h, 0).toLowerCase() === a.toLowerCase() && Number(wordAt(h, 1)) === id) { o.price = wordAt(h, 2); return o; }
                o.listingId = 0; return o; // stale pointer — not an active listing of mine
              }).catch(function () { o.listingId = 0; return o; });
            }).catch(function () { return { id: id, rarity: rar, listingId: 0, price: 0n }; });
          });
        }));
      });
    }).then(function (list) {
      pxW.scanning = false;
      if (account === a) pxW.owned = list || [];
      pxRenderMine();
    }).catch(function () {
      pxW.scanning = false;
      pxRenderMine();
    });
  }
  function pxRenderMine() {
    var body = $("pxMyBody"), mine = $("pxMyListings");
    if (!body) return;
    if (!account) {
      body.innerHTML = '<p class="hint">' + esc(t("pxMyOff")) + "</p>";
      if (mine) mine.innerHTML = "";
      return;
    }
    if (pxW.scanning) {
      body.innerHTML = '<p class="hint">' + esc(t("pxMyScanning")(fmtNum(pxW.scannedTotal))) + "</p>";
      return;
    }
    if (!pxW.owned) {
      body.innerHTML = '<p class="hint">' + esc(t("pxMyPrompt")) + "</p>";
      if (mine) mine.innerHTML = "";
      return;
    }
    var html = '<p class="hint">' + esc(t("pxMyCount")(pxW.owned.length)) +
      (pxW.scannedTotal > BigInt(pxW.scannedCap) ? " · " + esc(t("pxMyCapNote")(fmtNum(pxW.scannedCap))) : "") + "</p>";
    if (!pxW.owned.length) html += '<p class="hint">' + esc(t("pxMyEmpty")) + "</p>";
    else {
      html += '<div class="px-mine-grid">' + pxW.owned.map(function (o) {
        var r = PX_RAR[o.rarity] || PX_RAR[0];
        var foot = o.listingId
          ? '<span class="px-listed">' + esc(t("pxListedTag")(fmtBNB(o.price))) + "</span>"
          : '<button class="btn btn-ghost small" type="button" data-pxact="fill" data-token="' + o.id + '">' + esc(t("pxListBtn")) + "</button>";
        return '<div class="px-lst"><img src="sailpixels/' + r.slug + '.png" alt="' + esc(r.shipEn) + '" loading="lazy">' +
          '<div class="px-lst-name"><span class="px-dot" style="background:' + r.color + '"></span>' + esc(pxRarName(o.rarity)) + " · #" + o.id + "</div>" +
          '<div class="px-lst-ship">' + esc(r.shipEn) + " · " + esc(r.shipZh) + '</div><div class="px-lst-act">' + foot + "</div></div>";
      }).join("") + "</div>";
    }
    body.innerHTML = html;
    if (mine) {
      var listed = pxW.owned.filter(function (o) { return !!o.listingId; });
      mine.innerHTML = listed.length ? '<h4 class="px-sub">' + esc(t("pxMyListingsT")) + "</h4>" + listed.map(function (o) {
        return '<div class="earn-row"><span>#' + o.id + " · " + fmtBNB(o.price) + ' BNB</span>' +
          '<span class="px-upd"><input type="text" inputmode="decimal" data-i18n-ph="pxNewPricePh" placeholder="' + esc(t("pxNewPricePh")) + '" id="pxUpd-' + o.listingId + '">' +
          '<button class="btn btn-ghost small" type="button" data-pxact="update" data-id="' + o.listingId + '">' + esc(t("pxUpdateBtn")) + "</button>" +
          '<button class="btn btn-ghost small" type="button" data-pxact="cancel" data-id="' + o.listingId + '">' + esc(t("pxCancelBtn")) + "</button></span></div>";
      }).join("") : "";
    }
  }
  function doPxList() {
    var out = $("pxListOut");
    function fail(msg) { out.textContent = msg; out.className = "hint msg-bad"; }
    if (!account) { fail(t("mintNeedWallet")); return; }
    if (!chainOk) { toast(t("wrongNet")); ensureChain(); return; }
    var tokenId = parseInt($("pxListToken").value, 10);
    if (!tokenId || tokenId < 1) { fail(t("pxBadToken")); return; }
    var price = parseBnb($("pxListPrice").value);
    if (price === null || price < px.minPrice) { fail(t("pxBadPrice")(fmtBNB(px.minPrice))); return; }
    var N = CONFIG.PIXELS, M = CONFIG.PIXELS_MKT, a = account;
    out.textContent = t("pxListChecking"); out.className = "hint msg-wait";
    ethCall(N, PSEL.pxOwnerOf + encUint(tokenId)).then(function (h) {
      if (addrFromWord(h).toLowerCase() !== a.toLowerCase()) throw new Error(t("pxNotOwner"));
      return callUint(M, PSEL.mkListingOfToken + encUint(tokenId));
    }).then(function (lid) {
      if (!lid) return false;
      return ethCall(M, PSEL.mkListings + encUint(lid)).then(function (h) {
        if (addrAt(h, 0).toLowerCase() === a.toLowerCase() && Number(wordAt(h, 1)) === tokenId) throw new Error(t("pxAlreadyListed"));
        return false; // stale pointer — safe to list fresh
      });
    }).then(function () {
      return Promise.all([
        ethCall(N, PSEL.pxIsApprovedForAll + encAddr(a) + encAddr(M)).then(function (h) { return u256(h) !== 0n; }).catch(function () { return false; }),
        ethCall(N, PSEL.pxGetApproved + encUint(tokenId)).then(addrFromWord).catch(function () { return ""; })
      ]);
    }).then(function (ap) {
      var approved = ap[0] || (!!ap[1] && ap[1].toLowerCase() === M.toLowerCase());
      if (approved) return null;
      out.textContent = t("pxApproveStep"); out.className = "hint msg-wait";
      return sendTx(N, PSEL.pxSetApprovalForAll + encAddr(M) + encUint(1), 0n);
    }).then(function () {
      out.textContent = t("pxListStep"); out.className = "hint msg-wait";
      return sendTx(M, PSEL.mkList + encUint(tokenId) + encUint(price), 0n);
    }).then(function (hash) {
      out.innerHTML = esc(t("pxListOk")) + pxTxLink(hash);
      out.className = "hint msg-ok";
      pxW.owned = null;
      pxRenderMine(); pxLoadMarket();
    }).catch(function (e) {
      fail(t("pxListFail") + (e && e.message ? " (" + String(e.message).slice(0, 90) + ")" : ""));
    });
  }
  function pxActionClick(ev) {
    var b = ev.target.closest ? ev.target.closest("[data-pxact]") : null;
    if (!b) return;
    var act = b.getAttribute("data-pxact");
    if (act === "buy") pxDoBuy(Number(b.getAttribute("data-id")));
    else if (act === "cancel") pxDoCancel(Number(b.getAttribute("data-id")));
    else if (act === "update") pxDoUpdate(Number(b.getAttribute("data-id")));
    else if (act === "fill") {
      var inp = $("pxListToken");
      if (inp) { inp.value = b.getAttribute("data-token"); inp.scrollIntoView({ behavior: "smooth", block: "center" }); }
      var pf = $("pxListPrice"); if (pf) pf.focus();
    }
  }

  /* ================= referral ================= */
  var refEarnCache = { addr: null, total: 0n, count: 0, rows: [] };
  function siteBase() { return location.origin + location.pathname; }
  function genRefLink() {
    var addr = $("refAddrInput").value.trim() || account || "";
    if (!isAddr(addr)) { toast(t("genBadAddr")); return; }
    var link = siteBase() + "?ref=" + addr + "#/buy";
    $("refLinkOut").value = link;
    $("shareText").value = t("shareText")(link);
    loadRefEarnings(addr);
  }
  function headBlock() {
    return rpcJSON(LOG_RPCS, { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] }).then(function (h) { return parseInt(h, 16); });
  }
  function getLogsChunk(rpcs, fromB, toB, topics) {
    var payload = { jsonrpc: "2.0", id: 1, method: "eth_getLogs", params: [{ address: CONFIG.SALE, fromBlock: "0x" + fromB.toString(16), toBlock: "0x" + toB.toString(16), topics: topics }] };
    var k = 0;
    function attempt() {
      if (k >= rpcs.length) return Promise.reject(new Error("logs failed"));
      var url = rpcs[k++];
      return fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (j.error) throw new Error("logs error"); return j.result || []; })
        .catch(attempt);
    }
    return attempt();
  }
  function loadRefEarnings(addr) {
    var box = $("refEarnList"), tot = $("refEarnNum"), cnt = $("refEarnCount");
    if (!isAddr(addr)) return;
    if (live && live.totalRaised === 0n) { // nobody has bought yet — skip the scan entirely
      tot.textContent = "0";
      cnt.textContent = t("refEarnNone");
      box.innerHTML = "";
      return;
    }
    tot.textContent = "…";
    cnt.textContent = t("refEarnLoading");
    box.innerHTML = "";
    headBlock().then(function (head) {
      var topics = [REFERRAL_TOPIC, "0x" + encAddr(addr)];
      var chunks = [], CH = 4000;
      for (var f = CONFIG.SALE_DEPLOY_BLOCK; f <= head; f += CH) chunks.push([f, Math.min(f + CH - 1, head)]);
      var all = [];
      var chain = Promise.resolve();
      chunks.forEach(function (c) {
        chain = chain.then(function () {
          return getLogsChunk(LOG_RPCS, c[0], c[1], topics).then(function (logs) { all = all.concat(logs); });
        });
      });
      return chain.then(function () { return all; });
    }).then(function (logs) {
      var total = 0n, rows = [];
      logs.forEach(function (lg) {
        var amt = u256(lg.data);
        total += amt;
        rows.push({ buyer: addrFromWord(lg.topics[2] || ""), amt: amt, tx: lg.transactionHash, block: parseInt(lg.blockNumber, 16) });
      });
      rows.sort(function (a, b) { return b.block - a.block; });
      refEarnCache = { addr: addr, total: total, count: logs.length, rows: rows };
      tot.textContent = fmtBNB(total);
      cnt.textContent = t("refEarnCount")(rows.length);
      if (!rows.length) { box.innerHTML = ""; return; }
      var html = "";
      rows.slice(0, 8).forEach(function (rw) {
        html += '<div class="earn-row"><span>' + esc(t("buyerShort")(shortAddr(rw.buyer))) + ' · <a target="_blank" rel="noopener" href="https://bscscan.com/tx/' + rw.tx + '">tx</a></span><b>+' + fmtBNB(rw.amt) + " BNB</b></div>";
      });
      box.innerHTML = html;
    }).catch(function () {
      tot.textContent = "—";
      cnt.textContent = t("refEarnFail");
      box.innerHTML = "";
    });
  }

  /* ================= on-chain logs: board / countdown / market =================
     Log reads use their own endpoints (the AgentDoor-proven pattern): walk
     every LOG_RPC with a hard timeout; when an endpoint caps the range,
     split it adaptively instead of failing the whole scan. The event store
     lives in memory between the 30 s refreshes, guarded by two watermarks:
     evHead (highest block scanned) and evFloor (lowest block of the
     contiguous scanned window). The first pass walks BACKWARD in 500-block
     chunks from the chain head (AgentDoor v3.31 pattern); refreshes only
     scan the new blocks above evHead and keep walking downward until the
     sale deploy block — never a rescan from zero. */
  var evStore = { claims: [], mints: [], refs: [], roundOpened: {}, poolLaunched: null, seen: {} };
  var evFloor = null, evHead = null, evInit = false, evScanning = false, evFailed = false, evComplete = false;
  var blockTsCache = {};
  var BOARD_TOPICS = [[TOPICS.claimed, TOPICS.minted, TOPICS.referral, TOPICS.roundOpened, TOPICS.poolLaunched]];
  var LOT_WEI = CONFIG.LOT_TOKENS * 1000000000000000000n;

  function rpcLogsCall(method, params) {
    var eps = LOG_RPCS.concat([LOG_RPCS[0]]);
    function attempt(i) {
      if (i >= eps.length) return Promise.reject(new Error("log rpc failed"));
      var go = function () {
        var ctl = null, timer = null;
        if (window.AbortController) { ctl = new AbortController(); timer = setTimeout(function () { ctl.abort(); }, 9000); }
        return fetch(eps[i], {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params }),
          signal: ctl ? ctl.signal : undefined
        }).then(function (r) { return r.json(); }).then(function (j) {
          if (timer) clearTimeout(timer);
          if (j.error) throw new Error(j.error.message || "rpc error");
          return j.result;
        }).catch(function () { if (timer) clearTimeout(timer); return attempt(i + 1); });
      };
      if (i === eps.length - 1) return new Promise(function (res) { setTimeout(res, 700); }).then(go);
      return go();
    }
    return attempt(0);
  }
  function fetchLogsAdaptive2(fromB, toB, topics, budget) {
    if (budget.left <= 0) return Promise.resolve(null);
    budget.left--;
    return rpcLogsCall("eth_getLogs", [{ address: CONFIG.SALE, topics: topics, fromBlock: "0x" + fromB.toString(16), toBlock: "0x" + toB.toString(16) }])
      .then(function (ls) { return ls || []; })
      .catch(function () {
        if (toB - fromB < 100 || budget.left <= 0) return null;
        var mid = fromB + Math.floor((toB - fromB) / 2);
        return fetchLogsAdaptive2(fromB, mid, topics, budget).then(function (l) {
          if (l === null) return null;
          return fetchLogsAdaptive2(mid + 1, toB, topics, budget).then(function (r) { return r === null ? null : l.concat(r); });
        });
      });
  }
  function dataWord(lg, i) {
    var d = String(lg.data || "0x").replace(/^0x/, "");
    var w = d.slice(i * 64, i * 64 + 64);
    return w ? BigInt("0x" + w) : 0n;
  }
  function storeLog(lg) {
    var key = lg.transactionHash + ":" + lg.logIndex;
    if (evStore.seen[key]) return;
    evStore.seen[key] = true;
    var t0 = lg.topics[0], blk = parseInt(lg.blockNumber, 16), li = parseInt(lg.logIndex, 16);
    if (t0 === TOPICS.claimed) {
      evStore.claims.push({ user: addrFromWord(lg.topics[2]), amount: dataWord(lg, 0), block: blk, li: li, tx: lg.transactionHash });
    } else if (t0 === TOPICS.minted) {
      evStore.mints.push({ user: addrFromWord(lg.topics[1]), round: Number(BigInt(lg.topics[2])), lots: dataWord(lg, 0), amount: dataWord(lg, 1), paid: dataWord(lg, 2), block: blk, li: li, tx: lg.transactionHash });
    } else if (t0 === TOPICS.referral) {
      evStore.refs.push({ referrer: addrFromWord(lg.topics[1]), buyer: addrFromWord(lg.topics[2]), wei: dataWord(lg, 0), block: blk, li: li, tx: lg.transactionHash });
    } else if (t0 === TOPICS.roundOpened) {
      var rn = Number(BigInt(lg.topics[1]));
      if (!evStore.roundOpened[rn]) evStore.roundOpened[rn] = { block: blk, tx: lg.transactionHash };
    } else if (t0 === TOPICS.poolLaunched) {
      evStore.poolLaunched = { pool: addrFromWord(lg.topics[1]), block: blk, tx: lg.transactionHash };
    }
  }
  function getBlockTs(block) {
    if (blockTsCache[block] != null) return Promise.resolve(blockTsCache[block]);
    return rpcLogsCall("eth_getBlockByNumber", ["0x" + block.toString(16), false])
      .then(function (b) { var ts = b && b.timestamp ? parseInt(b.timestamp, 16) : 0; blockTsCache[block] = ts; return ts; })
      .catch(function () { return 0; });
  }
  function relTime(ts) {
    if (!ts) return "";
    var diff = Math.floor(Date.now() / 1000) - ts;
    if (diff < 60) return t("justNow");
    if (diff < 3600) return t("agoMin")(Math.max(1, Math.floor(diff / 60)));
    if (diff < 86400) return t("agoHour")(Math.floor(diff / 3600));
    return t("agoDay")(Math.floor(diff / 86400));
  }

  var boardRenderAt = 0;
  function scanBoard(manual) {
    if (evScanning || !live) return;
    // Zero-activity shortcut: no round ever opened (currentRound only ever
    // increases), nothing claimed or raised, not launched — no event of
    // interest can exist yet, on the first pass and on every refresh alike.
    if (live.round === 0 && live.freeSold === 0n && live.totalRaised === 0n && !live.launched) {
      headBlock().then(function (head) {
        evFloor = head; evHead = head; evInit = true; evComplete = true; evScanning = false;
        renderBoard(true); updateCountdownCard();
      }).catch(function () { });
      return;
    }
    evScanning = true;
    renderBoard(true);
    var budget = { left: manual ? 120 : 48 };
    var chunksDone = 0, maxChunks = manual ? 60 : 24;
    headBlock().then(function (head) {
      if (evHead === null) { evHead = head; evFloor = head + 1; evInit = true; }
      function finishDelta() {
        if (evHead >= head) return backward();
        var f = evHead + 1, toB = Math.min(f + 499, head);
        return fetchLogsAdaptive2(f, toB, BOARD_TOPICS, budget).then(function (ls) {
          if (ls === null) { evFailed = true; return backward(); }
          ls.forEach(storeLog);
          evHead = toB;
          return finishDelta();
        });
      }
      function backward() {
        if (evFloor <= CONFIG.SALE_DEPLOY_BLOCK) { evComplete = true; return done(); }
        if (chunksDone >= maxChunks) return done();
        var end = evFloor - 1, fromB = Math.max(CONFIG.SALE_DEPLOY_BLOCK, end - 499);
        return fetchLogsAdaptive2(fromB, end, BOARD_TOPICS, budget).then(function (ls) {
          if (ls === null) { evFailed = true; return done(); }
          ls.forEach(storeLog);
          evFloor = fromB;
          chunksDone++;
          renderBoard(false);
          // small pause between chunks keeps scrolling smooth and RPCs calm
          return new Promise(function (res) { setTimeout(res, 120); }).then(backward);
        });
      }
      function done() {
        evScanning = false;
        renderBoard(true);
        updateCountdownCard();
        renderMarket();
        return undefined;
      }
      return finishDelta();
    }).catch(function () {
      evScanning = false; evFailed = true;
      renderBoard(true);
    });
  }

  function renderBoard(force) {
    var now = Date.now();
    if (!force && now - boardRenderAt < 500) return;
    boardRenderAt = now;
    var bBody = $("buyersBody"), rBody = $("refsBody"), act = $("actList"), note = $("boardNote");
    if (!bBody || !rBody || !act) return;
    var hasEvents = evStore.claims.length + evStore.mints.length + evStore.refs.length > 0;
    if (note) {
      note.textContent = evFailed ? t("boardFail") : (evScanning || (evInit && !evComplete)) ? t("boardScanning") : "";
    }
    function stateRow(colspan) {
      // Once the first pass has run, the tables know their true state: show
      // the honest empty message (the note line carries any "syncing" hint),
      // never a loading label that would flicker on every refresh.
      var msg = !evInit ? t("boardLoading") : t("boardEmpty");
      return '<tr class="state-row"><td colspan="' + colspan + '">' + esc(msg) + "</td></tr>";
    }
    // ---- top buyers: Claimed (amount) + Minted (lots) per address
    var byUser = {};
    evStore.claims.forEach(function (e) {
      var u = byUser[e.user] || (byUser[e.user] = { lots: 0n, sail: 0n });
      u.lots += e.amount / LOT_WEI; u.sail += e.amount;
    });
    evStore.mints.forEach(function (e) {
      var u = byUser[e.user] || (byUser[e.user] = { lots: 0n, sail: 0n });
      u.lots += e.lots; u.sail += e.amount;
    });
    var buyers = Object.keys(byUser).map(function (a) { return { addr: a, lots: byUser[a].lots, sail: byUser[a].sail }; });
    buyers.sort(function (x, y) { return y.lots !== x.lots ? (y.lots > x.lots ? 1 : -1) : (y.sail > x.sail ? 1 : y.sail < x.sail ? -1 : 0); });
    bBody.innerHTML = buyers.length ? buyers.slice(0, 20).map(function (b, i) {
      return "<tr><td class=\"rk\">" + (i + 1) + '</td><td><a href="https://bscscan.com/address/' + b.addr + '" target="_blank" rel="noopener">' + shortAddr(b.addr) + '</a></td><td class="num">' + fmtNum(b.lots) + '</td><td class="num">' + fmtToken(b.sail) + "</td></tr>";
    }).join("") : stateRow(4);
    // ---- top referrers: ReferralPaid per referrer
    var byRef = {};
    evStore.refs.forEach(function (e) {
      var u = byRef[e.referrer] || (byRef[e.referrer] = { count: 0, wei: 0n });
      u.count++; u.wei += e.wei;
    });
    var refs = Object.keys(byRef).map(function (a) { return { addr: a, count: byRef[a].count, wei: byRef[a].wei }; });
    refs.sort(function (x, y) { return y.wei !== x.wei ? (y.wei > x.wei ? 1 : -1) : y.count - x.count; });
    rBody.innerHTML = refs.length ? refs.slice(0, 20).map(function (b, i) {
      return "<tr><td class=\"rk\">" + (i + 1) + '</td><td><a href="https://bscscan.com/address/' + b.addr + '" target="_blank" rel="noopener">' + shortAddr(b.addr) + '</a></td><td class="num">' + b.count + '</td><td class="num">' + fmtBNB(b.wei) + " BNB</td></tr>";
    }).join("") : stateRow(4);
    renderActivity();
  }
  function renderActivity() {
    var act = $("actList");
    if (!act) return;
    var all = evStore.claims.map(function (e) { return { kind: "claim", user: e.user, lots: e.amount / LOT_WEI, sail: e.amount, paid: 0n, block: e.block, li: e.li, tx: e.tx }; })
      .concat(evStore.mints.map(function (e) { return { kind: "buy", user: e.user, lots: e.lots, sail: e.amount, paid: e.paid, block: e.block, li: e.li, tx: e.tx }; }));
    if (!all.length) {
      act.innerHTML = '<p class="board-empty">' + esc(!evInit ? t("boardLoading") : t("boardEmpty")) + "</p>";
      return;
    }
    all.sort(function (x, y) { return y.block - x.block || y.li - x.li; });
    var top = all.slice(0, 15);
    var blocks = {};
    top.forEach(function (e) { blocks[e.block] = true; });
    Promise.all(Object.keys(blocks).map(function (bn) { return getBlockTs(Number(bn)); })).then(function () {
      // re-check nothing newer replaced the list meanwhile is overkill; paint
      act.innerHTML = top.map(function (e) {
        var when = relTime(blockTsCache[e.block] || 0);
        var detail = fmtNum(e.lots) + " " + esc(t("lotsUnit")) + " · " + fmtToken(e.sail) + " SAIL" + (e.kind === "buy" ? " · " + fmtBNB(e.paid) + " BNB" : "");
        return '<div class="act-row"><span class="act-badge ' + e.kind + '">' + esc(e.kind === "claim" ? t("actClaim") : t("actBuy")) + '</span>' +
          '<a class="act-addr" href="https://bscscan.com/address/' + e.user + '" target="_blank" rel="noopener">' + shortAddr(e.user) + "</a>" +
          '<span class="act-detail">' + detail + '</span>' +
          '<span class="act-when">' + (when ? esc(when) + " · " : "") + '<a href="https://bscscan.com/tx/' + e.tx + '" target="_blank" rel="noopener">tx↗</a></span></div>';
      }).join("");
    }).catch(function () { });
  }

  /* ================= round countdown (12-hour rounds) ================= */
  var cdState = { round: 0, endsAt: 0, fetching: false };
  function fetchRoundOpened(round) {
    if (cdState.fetching || evStore.roundOpened[round]) return;
    cdState.fetching = true;
    headBlock().then(function (head) {
      var budget = { left: 40 };
      var topics = [TOPICS.roundOpened, "0x" + encUint(round)];
      function step(end) {
        if (end < CONFIG.SALE_DEPLOY_BLOCK || evStore.roundOpened[round] || budget.left <= 0) { cdState.fetching = false; updateCountdownCard(); return undefined; }
        var fromB = Math.max(CONFIG.SALE_DEPLOY_BLOCK, end - 1499);
        return fetchLogsAdaptive2(fromB, end, topics, budget).then(function (ls) {
          if (ls && ls.length) { ls.forEach(storeLog); cdState.fetching = false; updateCountdownCard(); return undefined; }
          if (ls === null) { cdState.fetching = false; return undefined; }
          return step(fromB - 1);
        });
      }
      return step(evHead !== null ? Math.min(evHead, head) : head);
    }).catch(function () { cdState.fetching = false; });
  }
  function updateCountdownCard() {
    var card = $("cdCard");
    if (!card) return;
    var show = !!(live && live.round >= 1 && !live.closed && !live.launched);
    if (!show) { card.style.display = "none"; cdState.round = 0; cdState.endsAt = 0; return; }
    card.style.display = "";
    var lbl = $("cdLabel");
    if (lbl) lbl.textContent = t("cdLabel")(live.round);
    var ro = evStore.roundOpened[live.round];
    if (!ro) { fetchRoundOpened(live.round); paintCountdown(); return; }
    if (cdState.round !== live.round || !cdState.endsAt) {
      cdState.round = live.round;
      getBlockTs(ro.block).then(function (ts) {
        if (!ts) return;
        cdState.endsAt = (ts + 12 * 3600) * 1000;
        var ends = $("cdEnds");
        if (ends) ends.textContent = t("cdEndsAt")(new Date(cdState.endsAt).toLocaleString(lang === "en" ? "en-GB" : "zh-CN", { hour12: false }));
        paintCountdown();
      });
    }
    paintCountdown();
  }
  var cdLastText = "";
  function paintCountdown() {
    var el = $("cdTime");
    if (!el || !cdState.endsAt) { if (el && !cdState.endsAt) el.textContent = "--:--:--"; return; }
    var left = Math.max(0, Math.floor((cdState.endsAt - Date.now()) / 1000));
    var h = Math.floor(left / 3600), m = Math.floor((left % 3600) / 60), s = left % 60;
    var txt = String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    if (txt !== cdLastText) { cdLastText = txt; el.textContent = txt; }
  }

  /* ================= token market (DexScreener after launch) ================= */
  var dexCache = { pool: null, at: 0, data: null, failed: false };
  function fmtUsd(v) {
    if (v === null || v === undefined || isNaN(Number(v))) return "—";
    var n = Number(v);
    return "$" + n.toLocaleString("en-US", { maximumFractionDigits: n < 0.01 ? 10 : 2 });
  }
  function renderMarket() {
    var pre = $("mktPre"), post = $("mktPost");
    if (!pre || !post || !live) return;
    var zero = "0x0000000000000000000000000000000000000000";
    var poolAddr = live.poolAddr && live.poolAddr !== zero ? live.poolAddr : (evStore.poolLaunched ? evStore.poolLaunched.pool : null);
    if (!live.launched || !poolAddr) {
      pre.style.display = ""; post.style.display = "none";
      var f = $("mktFund"); if (f) f.textContent = fmtBNB(live.poolFund) + " BNB";
      var r = $("mktRaised"); if (r) r.textContent = fmtBNB(live.totalRaised) + " BNB";
      var s = $("mktState"); if (s) s.textContent = t("mktPreState");
      return;
    }
    pre.style.display = "none"; post.style.display = "";
    var pl = $("mktPoolLine");
    if (pl) pl.innerHTML = esc(t("mktLiveState")(shortAddr(poolAddr))) + ' · <a href="https://bscscan.com/address/' + poolAddr + '" target="_blank" rel="noopener">' + poolAddr + "</a>";
    var trade = $("mktTradeBtn"); if (trade) trade.href = "https://pancakeswap.finance/swap?outputCurrency=" + CONFIG.TOKEN;
    var ds = $("mktDsBtn"); if (ds) ds.href = "https://dexscreener.com/bsc/" + poolAddr;
    var chart = $("mktChart");
    if (chart && chart.getAttribute("data-pool") !== poolAddr) {
      chart.setAttribute("data-pool", poolAddr);
      chart.innerHTML = '<iframe src="https://dexscreener.com/bsc/' + poolAddr + '?embed=1&theme=dark&trades=0&info=0" title="SAIL / WBNB chart" loading="lazy"></iframe>';
    }
    if (dexCache.pool !== poolAddr || Date.now() - dexCache.at > 60000) loadDex(poolAddr);
    else paintDex();
  }
  function loadDex(poolAddr) {
    dexCache.pool = poolAddr; dexCache.at = Date.now();
    fetch("https://api.dexscreener.com/latest/dex/pairs/bsc/" + poolAddr)
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var p = j && j.pairs && j.pairs[0];
        if (!p) { dexCache.failed = true; dexCache.data = null; paintDex(); return; }
        dexCache.data = { price: p.priceUsd, liq: p.liquidity ? p.liquidity.usd : null, vol: p.volume ? p.volume.h24 : null };
        dexCache.failed = false;
        paintDex();
      }).catch(function () { dexCache.failed = true; paintDex(); });
  }
  function paintDex() {
    var p = $("mktPrice"), l = $("mktLiq"), v = $("mktVol");
    if (!p) return;
    if (dexCache.failed || !dexCache.data) {
      p.textContent = l.textContent = v.textContent = t("mktFail");
      return;
    }
    p.textContent = fmtUsd(dexCache.data.price);
    l.textContent = fmtUsd(dexCache.data.liq);
    v.textContent = fmtUsd(dexCache.data.vol);
  }

  function shareToX() {
    var link = $("refLinkOut").value.trim();
    if (!link) { genRefLink(); link = $("refLinkOut").value.trim(); }
    if (!link) return; // genRefLink already toasted the problem
    var text = $("shareText").value.trim() || t("shareText")(link);
    window.open("https://twitter.com/intent/tweet?text=" + encodeURIComponent(text), "_blank", "noopener");
  }
  function shareToSquare() {
    var link = $("refLinkOut").value.trim();
    if (!link) { genRefLink(); link = $("refLinkOut").value.trim(); }
    if (!link) return; // genRefLink already toasted the problem
    var text = $("shareText").value.trim() || t("shareText")(link);
    // Binance Square has no public composer intent URL: copy the template,
    // then open Square so the visitor only has to paste.
    copyText(text, t("squareCopied"));
    window.open("https://www.binance.com/en/square", "_blank", "noopener");
  }

  /* ================= hamburger menu ================= */
  function menuIsOpen() { var m = $("navMenu"); return !!m && m.classList.contains("open"); }
  function setMenu(open) {
    var m = $("navMenu"), b = $("navToggle");
    if (!m || !b) return;
    m.classList.toggle("open", !!open);
    b.setAttribute("aria-expanded", open ? "true" : "false");
  }

  /* ================= router ================= */
  var PAGES = ["home", "buy", "pixels", "referral", "tokenomics", "guide", "faq", "whitepaper"];
  var curPage = "home";
  function pageFromHash() {
    var m = (location.hash || "").match(/#\/(home|buy|pixels|referral|tokenomics|guide|faq|whitepaper)/);
    return m ? m[1] : "home";
  }
  var navTimer = null;
  function activatePage(name, prev) {
    PAGES.forEach(function (p) {
      var el = $("page-" + p);
      el.classList.remove("on", "enter-r", "enter-l", "enter-f", "leaving", "leave-r", "leave-l", "leave-f");
      if (p === name) {
        void el.offsetWidth; // restart the animation
        el.classList.add("on");
        var dir = PAGES.indexOf(name) - PAGES.indexOf(prev);
        el.classList.add(dir > 0 ? "enter-r" : dir < 0 ? "enter-l" : "enter-f");
      }
    });
    document.querySelectorAll(".nav-menu a[data-page]").forEach(function (a) {
      a.classList.toggle("on", a.getAttribute("data-page") === name);
    });
  }
  function goPage(name, scrollId) {
    if (PAGES.indexOf(name) < 0) name = "home";
    setMenu(false);
    // Route changes always re-read the chain, so no page ever shows a
    // stale snapshot right after navigating (the 30s poll still runs).
    if (live) loadLive();
    if (navTimer) { clearTimeout(navTimer); navTimer = null; }
    var prev = curPage, next = name;
    curPage = name;
    var want = "#/" + name;
    if (location.hash !== want) { try { history.replaceState(null, "", want); } catch (e) { } }
    function finish() {
      activatePage(next, prev);
      if (scrollId) {
        var target = $(scrollId);
        if (target) setTimeout(function () { target.scrollIntoView({ behavior: "smooth", block: "start" }); }, 60);
      } else {
        window.scrollTo(0, 0);
      }
      if (next === "referral" && account && !$("refLinkOut").value) {
        $("refAddrInput").value = account;
        genRefLink();
      }
      if (next === "pixels") { pxLoad(); pxLoadMarket(); }
    }
    // Smooth two-phase transition: the current page fades/slides out
    // briefly, then the new page eases in. Rapid taps skip straight to
    // the latest target; reduced-motion users get an instant swap.
    var prevEl = $("page-" + prev);
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prev !== next && prevEl && prevEl.classList.contains("on") && !reduce) {
      var dir = PAGES.indexOf(next) - PAGES.indexOf(prev);
      prevEl.classList.add("leaving", dir > 0 ? "leave-r" : dir < 0 ? "leave-l" : "leave-f");
      navTimer = setTimeout(function () { navTimer = null; finish(); }, 150);
    } else {
      finish();
    }
  }

  /* ================= effects: ripple + bubbles ================= */
  function bindRipple() {
    document.addEventListener("pointerdown", function (ev) {
      var btn = ev.target.closest ? ev.target.closest(".btn") : null;
      if (!btn || btn.disabled) return;
      var rect = btn.getBoundingClientRect();
      var d = Math.max(rect.width, rect.height) * 1.1;
      var s = document.createElement("span");
      s.className = "ripple";
      s.style.width = s.style.height = d + "px";
      s.style.left = (ev.clientX - rect.left - d / 2) + "px";
      s.style.top = (ev.clientY - rect.top - d / 2) + "px";
      btn.appendChild(s);
      setTimeout(function () { s.remove(); }, 650);
    });
  }
  function spawnBubbles() {
    var box = $("bubbles"); if (!box) return;
    var html = "";
    for (var i = 0; i < 14; i++) {
      var size = 6 + Math.floor(Math.random() * 20);
      var left = (Math.random() * 98).toFixed(1);
      var dur = (10 + Math.random() * 12).toFixed(1);
      var delay = (-Math.random() * 20).toFixed(1);
      html += '<span class="bubble" style="left:' + left + "%;width:" + size + "px;height:" + size + "px;animation-duration:" + dur + "s;animation-delay:" + delay + 's"></span>';
    }
    box.innerHTML = html;
  }

  /* ================= faq accordion ================= */
  function bindFaq() {
    document.querySelectorAll(".faq-item").forEach(function (item) {
      var q = item.querySelector(".faq-q"), a = item.querySelector(".faq-a");
      q.addEventListener("click", function () {
        var open = item.classList.toggle("open");
        a.style.maxHeight = open ? a.scrollHeight + "px" : "0px";
      });
    });
  }

  /* ================= language-dependent re-render ================= */
  function refreshDynamic() {
    if (live) renderLive();
    renderHeaderCta();
    refreshConnectBtn();
    renderWalletCard();
    if (claimCheck) renderClaimCheck();
    var mo = $("mintOut");
    if (mo && !mo.innerHTML) { /* leave user messages alone */ }
    refreshActions();
    renderBoard(true);
    if (dexCache.data || dexCache.failed) paintDex();
    pxRenderAll();
  }

  /* ================= boot ================= */
  function boot() {
    captureI18n();
    $("shipStage").innerHTML = shipSvg();
    document.querySelectorAll('a[href="https://x.com/SailAgents"]').forEach(function (a) { a.href = CONFIG.X_URL; });
    renderRoundCards();
    spawnBubbles();
    bindRipple();
    bindFaq();
    // language
    $("langZh").addEventListener("click", function () { applyLang("zh"); });
    $("langEn").addEventListener("click", function () { applyLang("en"); });
    // nav / router
    document.addEventListener("click", function (ev) {
      var a = ev.target.closest ? ev.target.closest("[data-page]") : null;
      if (!a) return;
      ev.preventDefault();
      goPage(a.getAttribute("data-page"), a.getAttribute("data-scroll"));
    });
    window.addEventListener("hashchange", function () { goPage(pageFromHash()); });
    goPage(pageFromHash());
    curPage = pageFromHash();
    // hamburger menu: toggle, close on outside click / Escape (selecting a
    // menu item closes it too, via goPage)
    var ntg = $("navToggle");
    if (ntg) ntg.addEventListener("click", function () { setMenu(!menuIsOpen()); });
    document.addEventListener("click", function (ev) {
      if (!menuIsOpen()) return;
      var tg = ev.target;
      if (tg.closest && (tg.closest("#navMenu") || tg.closest("#navToggle"))) return;
      setMenu(false);
    });
    document.addEventListener("keydown", function (ev) { if (ev.key === "Escape") setMenu(false); });
    // Returning to the tab/app (mobile browsers throttle timers in the
    // background) forces an immediate fresh read instead of a stale page.
    document.addEventListener("visibilitychange", function () { if (!document.hidden) loadLive(); });
    // wallet (Buy page only — the header CTA above is navigation, not connect)
    var cb2 = $("connectBtn2");
    if (cb2) cb2.addEventListener("click", connectWallet);
    var prov = getProvider();
    if (prov) {
      // silent restore: an already-authorized wallet (or one used earlier in
      // this session) reconnects without a popup.
      provReq("eth_accounts").then(function (accs) {
        if (accs && accs[0]) {
          account = accs[0]; setSessionWallet(true);
          ensureChain().then(function () { refreshConnectBtn(); renderWalletCard(); loadMyStatus(); refreshActions(); });
        }
      }).catch(function () { });
      if (typeof prov.on === "function") {
        prov.on("accountsChanged", function (accs) {
          if (!accs || !accs[0]) { resetWalletState(); return; }
          account = accs[0]; setSessionWallet(true);
          myLots = [0n, 0n, 0n, 0n, 0n]; mySail = null; myIds = null; myBnb = null;
          refreshConnectBtn(); renderWalletCard(); loadMyStatus(); refreshActions();
          if (claimCheck) renderClaimCheck();
        });
        prov.on("chainChanged", function () {
          ensureChain().then(function () { renderWalletCard(); refreshActions(); });
          loadLive();
        });
        prov.on("disconnect", function () { resetWalletState(); });
      }
    }
    // claim
    $("checkIdBtn").addEventListener("click", function () {
      var v = $("handleInput").value.trim();
      if (!v) { $("claimOut").textContent = t("chkInput"); $("claimOut").className = "hint msg-bad"; return; }
      if (!agentIdFromHandle(v)) { $("claimOut").textContent = t("chkBad"); $("claimOut").className = "hint msg-bad"; return; }
      checkClaim();
    });
    $("handleInput").addEventListener("keydown", function (ev) { if (ev.key === "Enter") $("checkIdBtn").click(); });
    $("claimBtn").addEventListener("click", doClaim);
    // mint
    $("lotMinus").addEventListener("click", function () { var v = Math.max(1, parseLots() - 1); $("lotInput").value = v; refreshActions(); });
    $("lotPlus").addEventListener("click", function () { var v = Math.min(10, parseLots() + 1); $("lotInput").value = v; refreshActions(); });
    $("lotInput").addEventListener("input", refreshActions);
    $("refInput").addEventListener("input", refreshActions);
    $("mintBtn").addEventListener("click", doMint);
    // SailPixels page
    var pqm = $("pxQtyMinus");
    if (pqm) pqm.addEventListener("click", function () { $("pxQtyInput").value = Math.max(1, pxParseQty() - 1); pxUpdateCost(); });
    var pqp = $("pxQtyPlus");
    if (pqp) pqp.addEventListener("click", function () { $("pxQtyInput").value = Math.min(10, pxParseQty() + 1); pxUpdateCost(); });
    var pqi = $("pxQtyInput");
    if (pqi) pqi.addEventListener("input", pxUpdateCost);
    var pmb = $("pxMintBtn");
    if (pmb) pmb.addEventListener("click", doPxMint);
    var pmr = $("pxMktRefresh");
    if (pmr) pmr.addEventListener("click", function () { pxLoad(); pxLoadMarket(); });
    var psb = $("pxScanBtn");
    if (psb) psb.addEventListener("click", pxScanMine);
    var plb = $("pxListBtn");
    if (plb) plb.addEventListener("click", doPxList);
    document.addEventListener("click", pxActionClick);
    // referral
    $("genRefBtn").addEventListener("click", genRefLink);
    $("copyRefBtn").addEventListener("click", function () { if ($("refLinkOut").value) copyText($("refLinkOut").value); });
    $("copyShareBtn").addEventListener("click", function () { if ($("shareText").value) copyText($("shareText").value); });
    $("refAddrInput").addEventListener("keydown", function (ev) { if (ev.key === "Enter") genRefLink(); });
    $("xFollowBtn").href = CONFIG.X_URL;
    // board refresh + agent guide copy buttons + X share + countdown ticker
    var brb = $("boardRefreshBtn");
    if (brb) brb.addEventListener("click", function () { scanBoard(true); });
    var caf = $("copyAgentFree");
    if (caf) caf.addEventListener("click", function () { copyText($("agentFreeText").textContent.trim()); });
    var cab = $("copyAgentBuy");
    if (cab) cab.addEventListener("click", function () { copyText($("agentBuyText").textContent.trim()); });
    var cpx = $("copyAgentPx");
    if (cpx) cpx.addEventListener("click", function () { copyText($("agentPxText").textContent.trim()); });
    var csp = $("copySkillPrompt");
    if (csp) csp.addEventListener("click", function () { copyText($("skillPromptText").textContent.trim()); });
    var sxb = $("shareXBtn");
    if (sxb) sxb.addEventListener("click", shareToX);
    var ssb = $("shareSquareBtn");
    if (ssb) ssb.addEventListener("click", shareToSquare);
    [["copyToken", CONFIG.TOKEN], ["copySale", CONFIG.SALE], ["copyRegistry", CONFIG.REGISTRY], ["copyPixels", CONFIG.PIXELS], ["copyPixelsMkt", CONFIG.PIXELS_MKT]].forEach(function (pair) {
      var b = $(pair[0]);
      if (b) b.addEventListener("click", function () {
        copyText(pair[1]);
        // in-place feedback on the pill itself, on top of the toast
        var old = b.textContent;
        b.textContent = t("copied");
        b.classList.add("done");
        setTimeout(function () { b.textContent = old; b.classList.remove("done"); }, 1600);
      });
    });
    setInterval(paintCountdown, 1000);
    // footer contract addresses: show + link to BscScan; click also copies
    [["cToken", CONFIG.TOKEN], ["cSale", CONFIG.SALE], ["cRegistry", CONFIG.REGISTRY], ["cPixels", CONFIG.PIXELS], ["cPixelsMkt", CONFIG.PIXELS_MKT]].forEach(function (pair) {
      var el = $(pair[0]); if (!el) return;
      el.textContent = pair[1];
      el.href = "https://bscscan.com/address/" + pair[1];
      el.addEventListener("click", function () { copyText(pair[1]); });
    });
    var cx = $("cX"); if (cx) cx.href = CONFIG.X_URL;
    // ?ref= prefill (kept across nav by localStorage)
    var refParam = null;
    try {
      var m = location.search.match(/[?&]ref=(0x[0-9a-fA-F]{40})/);
      if (m) { refParam = m[1]; localStorage.setItem("agentsail-ref", refParam); }
      else refParam = localStorage.getItem("agentsail-ref");
    } catch (e) { }
    if (refParam && isAddr(refParam)) {
      $("refInput").value = refParam;
      toast(t("refFromLink")(shortAddr(refParam)));
    }
    applyLang(lang, true);
    loadLive();
    setInterval(loadLive, 30000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
