import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Escrow } from "../target/types/escrow";
import {
	Keypair,
	LAMPORTS_PER_SOL,
	PublicKey,
	SystemProgram,
	Transaction,
} from "@solana/web3.js";
import {
	MINT_SIZE,
	TOKEN_2022_PROGRAM_ID,
	createAssociatedTokenAccountIdempotentInstruction,
	createInitializeMint2Instruction,
	createMintToInstruction,
	getAssociatedTokenAddressSync,
	getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";
import { randomBytes } from "crypto";
import { expect } from "chai";

describe("escrow", () => {
	// Load the provider
	const provider = anchor.AnchorProvider.env();
	anchor.setProvider(provider);
	const program = anchor.workspace.AnchorEscrow as Program<Escrow>;

	const connection = provider.connection;

	const tokenProgram = TOKEN_2022_PROGRAM_ID;

	// Waits for a transaction to be confirmed by the network
	const confirm = async (signature: string): Promise<string> => {
		const block = await connection.getLatestBlockhash();
		await connection.confirmTransaction({
			signature,
			...block,
		});
		return signature;
	};
	// Logs the transaction signature with a link to the explorer
	const log = async (signature: string): Promise<string> => {
		console.log(
			`\tYour transaction signature: https://explorer.solana.com/transaction/${signature}?cluster=custom&customUrl=${connection.rpcEndpoint}`
		);
		return signature;
	};

	const seed = new BN(randomBytes(8));

	// Generate the key pairs for the maker, taker, and two mints
	// These represent differnet entities and assets involved in the escrow transactions
	const [maker, taker, mintA, mintB] = Array.from({ length: 4 }, () =>
		Keypair.generate()
	);

	// Calculate the associted token addresses for both the maker and taker for each mint type
	// These addresses are where the tokens will be stored:
	//
	// `makerAtaA` and `makerAtaB` are the ATAs for the maker for two different token types (represented by `mintA` and `mintB`)
	// - `makerAtaA` might be used for the tokens the maker is depositing into the escrow
	// - `makerAtaB` could be used for receiving a different type of token as part of the transaction outcomes or other scenearios
	//
	// `takerAtaA` and `tokenAtaB` are ATAs for the taker, corresponding to the same token mints
	// - `takerAtaA` corresponds to `mintA`
	// - `takerAtaB` corresponds to `mintB`
	// Depending on the transaction logic, the taker might receive tokens from `mintA` and provide tokens from `mintB`, or vice versa
	const [makerAtaA, makerAtaB, takerAtaA, takerAtaB] = [maker, taker]
		.map((a) =>
			[mintA, mintB].map((m) =>
				getAssociatedTokenAddressSync(
					m.publicKey,
					a.publicKey,
					false,
					tokenProgram
				)
			)
		)
		.flat();

	// Calculates a PDA that will act as the escrow account- the one that will hold the state of the escrow transaction, the seed, amounts to be sent/received, and ownership details
	// This escrow address is derived from the seeds set up in the accounts of the program, which are "escrow", the public key of the maker, and our generated seed, all as buffers:
	// - This ensures the address is unique and predictable by the program but doesn't have a corresponding private key to it
	const escrow = PublicKey.findProgramAddressSync(
		[
			Buffer.from("escrow"),
			maker.publicKey.toBuffer(),
			seed.toArrayLike(Buffer, "le", 8),
		],
		program.programId
	)[0];

	// This is an associated token account created for the escrow PDA to hold SPL tokens (specially `mintA` tokens)
	// This account will act like a "vault" where the tokens are securely held until the conditions of the escrow are met
	const vault = getAssociatedTokenAddressSync(
		mintA.publicKey, // mint
		escrow, // owner
		true, // allowOwnerOffCurve- true because there isn't a private key for the escrow, as previously derived
		tokenProgram // programId
	);

	const accounts = {
		maker: maker.publicKey,
		taker: taker.publicKey,
		mintA: mintA.publicKey,
		mintB: mintB.publicKey,
		makerAtaA,
		makerAtaB,
		takerAtaA,
		takerAtaB,
		escrow,
		vault,
		tokenProgram,
	};

	async function tokenBalances(accounts: { [label: string]: PublicKey }) {
		let balances: { [label: string]: number } = {};
		for (const [label, publicKey] of Object.entries(accounts)) {
			if (label.includes("Ata")) {
				try {
					const tokenAccountInfo =
						await provider.connection.getParsedAccountInfo(
							publicKey
						);

					if (
						!tokenAccountInfo.value ||
						!("parsed" in tokenAccountInfo.value.data)
					) {
						throw new Error(
							"Token account info is not available or not parsed"
						);
					}

					const mintAddress =
						tokenAccountInfo.value.data.parsed.info.mint;

					const mintInfo =
						await provider.connection.getParsedAccountInfo(
							new PublicKey(mintAddress)
						);

					if (!mintInfo.value || !("parsed" in mintInfo.value.data)) {
						throw new Error(
							"Mint info is not available or not parsed"
						);
					}

					const decimals = mintInfo.value.data.parsed.info.decimals;

					const balanceInfo =
						await provider.connection.getTokenAccountBalance(
							publicKey
						);
					const amount = Number(balanceInfo.value.amount);
					const balance = amount / Math.pow(10, decimals);

					console.log(`\t${label} balance: ${balance}`);
					balances = { ...balances, [label]: balance };
				} catch (error) {
					continue;
				}
			}
		}

		return balances;
	}

	it("Airdrop and setup mints", async () => {
		let lamports = await getMinimumBalanceForRentExemptMint(connection);
		let tx = new Transaction();
		tx.instructions = [
			// Accounts funding: Airdrops 10 SOL to the maker and taker wallets to cover transaction fees and potential costs
			...[maker, taker].map((account) =>
				SystemProgram.transfer({
					fromPubkey: provider.publicKey,
					toPubkey: account.publicKey,
					lamports: 10 * LAMPORTS_PER_SOL,
				})
			),

			// Mint accounts creation: Sets up new mint accounts for `mintA` and `mintB` by creating new accounts funded with enough lamports to be rent-exempt, specifying the account size needed for mints
			...[mintA, mintB].map((mint) =>
				SystemProgram.createAccount({
					fromPubkey: provider.publicKey,
					newAccountPubkey: mint.publicKey,
					lamports,
					space: MINT_SIZE,
					programId: tokenProgram,
				})
			),

			// Mint and Minting Tokens Initialization: For each mint, it initializes the mint, sets up the associated token accounts for the maker and taker, and mint a large amount of tokens to these accounts
			...[
				{
					mint: mintA.publicKey,
					authority: maker.publicKey,
					ata: makerAtaA,
				},
				{
					mint: mintB.publicKey,
					authority: taker.publicKey,
					ata: takerAtaB,
				},
			].flatMap((x) => [
				createInitializeMint2Instruction(
					x.mint,
					6,
					x.authority,
					null,
					tokenProgram
				),
				createAssociatedTokenAccountIdempotentInstruction(
					provider.publicKey,
					x.ata,
					x.authority,
					x.mint,
					tokenProgram
				),
				createMintToInstruction(
					x.mint,
					x.ata,
					x.authority,
					1_000 * 10 ** 6,
					undefined,
					tokenProgram
				),
			]),
		];

		await provider
			.sendAndConfirm(tx, [mintA, mintB, maker, taker])
			.then(log);

		const balances = await tokenBalances({
			makerAtaA,
			makerAtaB,
			takerAtaA,
			takerAtaB,
		});
		console.log("\n\tBalances after airdrop and mint setup:");

		expect(balances).to.exist;
		expect(balances.makerAtaA).to.equal(1000);
		expect(balances.takerAtaB).to.equal(1000);
	});

	it("Make: deposits deposit amount of mint_a from the maker and receives receive amount of mint_b", async () => {
		const deposit = new BN(100 * 1e6);
		const receive = new BN(200 * 1e6);

		await program.methods
			.make(seed, deposit, receive)
			.accounts({ ...accounts })
			.signers([maker])
			.rpc()
			.then(confirm)
			.then(log);

		const escrowAccount = await program.account.escrow.fetch(escrow);
		console.log("\tEscrow account:");
		console.log(escrowAccount);

		const balances = await tokenBalances({
			makerAtaA,
			makerAtaB,
			escrow,
			vault,
			takerAtaA,
			takerAtaB,
		});
		console.log("\n\tBalances after 'Make':");
		console.log(balances);

		expect(balances).to.exist;
		expect(balances.makerAtaA).to.equal(900);
		expect(balances.takerAtaB).to.equal(1000);
	});

	xit("Refund: refunds the deposited mint_a tokens to the maker and closes the escrow- might be used in case the taker doesn't fulfill their part of the agreement", async () => {
		try {
			await program.methods
				.refund()
				.accounts({
					...accounts,
					tokenProgram: tokenProgram,
				})
				.signers([maker])
				.rpc()
				.then(confirm)
				.then(log);
		} catch (error) {
			console.error("Error during the Refund test:", error);
		}
	});

	it("Take: deposits receive amount of mint_b from the taker (fulfilling the agreement) and withdraws the deposited mint_a tokens to the taker, then finalizes the escrow", async () => {
		try {
			await program.methods
				.take()
				.accounts({ ...accounts })
				.signers([taker])
				.rpc()
				.then(confirm)
				.then(log);

			// Attempt to fetch the closed escrow account
			try {
				const escrowAccount = await program.account.escrow.fetch(
					escrow
				);
				console.log("\tEscrow account:");
				console.log(escrowAccount);

				throw new Error(
					"Escrow account still exists after it should have been closed."
				);
			} catch (e) {
				if (e.toString().includes("Account does not exist")) {
					console.log(
						"\n\tEscrow account successfully closed, as expected."
					);
				} else {
					throw e;
				}
			}
		} catch (e) {
			console.error("An unexpected error occurred:", e);
			throw e;
		}

		const balances = await tokenBalances({
			makerAtaA,
			makerAtaB,
			escrow,
			vault,
			takerAtaA,
			takerAtaB,
		});
		console.log("\n\tBalances after 'Take':");
		console.log(balances);

		expect(balances).to.exist;
		expect(balances.makerAtaA).to.equal(900);
		expect(balances.makerAtaB).to.equal(200);
		expect(balances.takerAtaA).to.equal(100);
		expect(balances.takerAtaB).to.equal(800);
	});

	after(async () => {
		console.log("\n\tAccounts reference:");
		console.log(
			`\tmakerAtaA - Account used by the maker to deposit tokens A into the escrow`
		);
		console.log(
			`\tmakerAtaB - Account used by the maker to receive tokens B from the escrow`
		);
		console.log(
			`\ttakerAtaA - Account used by the taker to receive tokens A from the escrow`
		);
		console.log(
			`\ttakerAtaB - Account used by the taker to deposit tokens B into the escrow`
		);
		console.log(
			`\tescrow - Escrow account that holds the state of the escrow transaction`
		);
		console.log(
			`\tvault - Associated token account used by the escrow to hold tokens A`
		);
	});
});
