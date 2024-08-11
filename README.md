# Anchor Escrow

## Overview

Anchor-based Solana program to facilitate escrow transactions for SPL tokens, allowing users to engage in secure, conditional exchanges. It includes functionalities for creating escrow instances, depositing tokens under specific conditions, executing token swaps when conditions are met, and refunding deposits when necessary.

## Features

-   **Escrow Creation**: Initialize escrow with specific terms, including deposit amounts and token types.
-   **Deposit Tokens**: Users can securely deposit SPL tokens into the escrow.
-   **Conditional Execution**: Transactions (take actions) occur only if predefined conditions are satisfied, ensuring trustless agreements.
-   **Refunds**: Deposits can be refunded if conditions for transaction completion are not met.
-   **Secure Closure**: Escrow can be closed securely, releasing funds to the rightful owners.

## Usage

### Commands

-   **Initialize an Escrow**: Set the terms of the escrow, including the tokens and amounts to be exchanged.
-   **Deposit to Escrow**: Transfer tokens from a user's wallet to the escrow.
-   **Take from Escrow**: Complete the exchange if conditions are met, transferring ownership of the tokens.
-   **Refund from Escrow**: Return the tokens to the original owner if the conditions are not met.

## Code Structure

-   **`lib.rs`**: The entry point of the program, containing the main business logic.
-   **contexts/**: Defines the context modules used for different operations within the program.
    -   **`make.rs`**: Context for creating a new escrow agreement.
    -   **`take.rs`**: Context for executing the escrow agreement.
    -   **`refund.rs`**: Context for refunding the escrow agreement.
-   **state/**: Manages the state objects that represent escrow agreements.
    -   **`escrow.rs`**: Definition of the escrow state and its associated methods.

## Tests

-   **Ecrow Initialization**: Tests that escrows are initialized with correct parameters.
    -   Initializes all the accounts required for the escrow.
-   **Token Deposits**: Checks that tokens are correctly deposited into the escrow.
-   **Conditional Executions**: Verifies that transactions only execute under the correct conditions.
-   **Refund Mechanisms**: Ensures that tokens are refunded accurately when conditions are not met.

### Running Tests

To run the tests, execute the following command:

```bash
yarn # Install dependencies
anchor build # Build the program and generate the IDL
anchor test # Run the tests
```
