import {
    Address,
    BigInt,
    BigDecimal,
    log
} from '@graphprotocol/graph-ts'

import { GeistToken as TokenContract } from "../../generated/GeistToken/GeistToken"

import { 
    Token as TokenEntity, 
    RewardToken as RewardTokenEntity, 
    UsageMetricsDailySnapshot as UsageMetricsDailySnapshotEntity, 
    UniqueUsers as UniqueUsersEntity,
    FinancialsDailySnapshot as FinancialsDailySnapshotEntity,
} from "../../generated/schema"

import { 
    ZERO_BD,
    SECONDS_PER_DAY,
    DEPOSIT_INTERACTION,
    WITHDRAW_INTERACTION,
    BORROW_INTERACTION,
    REWARD_INTERACTION,
    REPAY_INTERACTION,
    STAKE_INTERACTION,
    UNSTAKE_INTERACTION,
    PROTOCOL_ID
} from "../common/constants";

import { 
    TOKEN_NAME_GEIST, 
    TOKEN_DECIMALS_GEIST, 
    REWARD_TOKEN_NAME, 
    REWARD_TOKEN_DECIMALS, 
    REWARD_TOKEN_SYMBOL,
    PRICE_ORACLE,
    TOKEN_ADDRESS_GEIST,
    TOKEN_ADDRESS_gFTM,
    TOKEN_ADDRESS_gCRV,
    TOKEN_ADDRESS_gDAI,
    TOKEN_ADDRESS_gETH,
    TOKEN_ADDRESS_gMIM,
    TOKEN_ADDRESS_gLINK,
    TOKEN_ADDRESS_gUSDC,
    TOKEN_ADDRESS_gWBTC,
    TOKEN_ADDRESS_gfUSDT,
    TOKEN_ADDRESS_DAI,
    TOKEN_ADDRESS_WFTM,
    TOKEN_ADDRESS_CRV,
    TOKEN_ADDRESS_ETH,
    TOKEN_ADDRESS_MIM,
    TOKEN_ADDRESS_LINK,
    TOKEN_ADDRESS_USDC,
    TOKEN_ADDRESS_BTC,
    TOKEN_ADDRESS_fUSDT,
    GEIST_FTM_LP_ADDRESS
} from "../common/addresses"

import { 
    AaveOracle,
    OwnershipTransferred
} from "../../generated/MultiFeeDistribution/AaveOracle"

import { 
    SpookySwapGEISTFTM,
    Transfer
} from "../../generated/MultiFeeDistribution/SpookySwapGEISTFTM"

import { 
    convertTokenToDecimal,
    exponentToBigDecimal,
    bigIntToPercentage
} from "../common/utils"


export function initializeToken(address: Address): TokenEntity {
    let token = TokenEntity.load(address.toHexString());

    if (token) {
        return token;
    }

    token = new TokenEntity(address.toHexString());

    // Replace GeistToken contract with default ERC20?
    let tokenContract = TokenContract.bind(address);

    token.id = address.toHexString();
    token.decimals = tokenContract.try_decimals().reverted ? 
                     TOKEN_DECIMALS_GEIST: tokenContract.try_decimals().value.toI32();
    token.name = tokenContract.try_name().reverted ? 
                 TOKEN_NAME_GEIST: tokenContract.try_name().value.toString();
    token.symbol = tokenContract.try_name().reverted ? 
                   TOKEN_NAME_GEIST: tokenContract.try_name().value.toString();
    token.save();
    return token;
}

export function initializeRewardToken(address: Address, rewardType: string): RewardTokenEntity {
    let rewardToken = RewardTokenEntity.load(address.toHexString());
       
    if (rewardToken) {
        return rewardToken;
    }

    rewardToken = new RewardTokenEntity(address.toHexString());

    let tokenContract = TokenContract.bind(address);
    rewardToken.id = address.toHexString();
    rewardToken.decimals = tokenContract.try_decimals().reverted ? 
                           REWARD_TOKEN_DECIMALS: tokenContract.try_decimals().value.toI32();
    rewardToken.name = tokenContract.try_name().reverted ? 
                       REWARD_TOKEN_NAME: tokenContract.try_name().value.toString();
    rewardToken.symbol = tokenContract.try_symbol().reverted ? 
                         REWARD_TOKEN_SYMBOL: tokenContract.try_symbol().value.toString();
    rewardToken.type = rewardType;
    rewardToken.save();
    return rewardToken;
}

export function getUsageMetrics(
    block_number: BigInt, 
    timestamp: BigInt, 
    from: Address
    ): UsageMetricsDailySnapshotEntity {
    // Number of days since Unix epoch
    // Note: This is an unsafe cast to int, this should be handled better, 
    // perhaps some additional rounding logic
    let id: i64 = timestamp.toI64() / SECONDS_PER_DAY;
  
    // Check if the id (i.e. the day) exists in the store
    let usageMetrics = UsageMetricsDailySnapshotEntity.load(id.toString());
  
    // If the id does not exist, create it and reset values
    if (!usageMetrics) {
      usageMetrics = new UsageMetricsDailySnapshotEntity(id.toString());
      usageMetrics.id = id.toString();
      usageMetrics.activeUsers = 0;
      usageMetrics.totalUniqueUsers = 0;
      usageMetrics.dailyTransactionCount = 0;
    }
  
    // Combine the id and the user address to generate a unique user id for the day
    let userId: string = id.toString() + from.toHexString()
    let userExists = UniqueUsersEntity.load(userId);
  
    // If the user id does not already exist in the store, add to unique users
    if (!userExists) {
      userExists = new UniqueUsersEntity(userId);
      userExists.id = userId;

      usageMetrics.activeUsers += 1;
      usageMetrics.totalUniqueUsers += 1;
    }
  
    // The protocol is defined in the schema as type Protocol!
    // But doesnt this create a circular dependency?
    // Protocol depends on usageMetrics, and usageMetrics depends on Protocol
    usageMetrics.protocol = PROTOCOL_ID;
    usageMetrics.dailyTransactionCount += 1
    usageMetrics.blockNumber = block_number;
    usageMetrics.timestamp = timestamp;
  
    userExists.save();

    log.warning(
        "Adding to UsageMetricsDailySnapshot with ID={}. activeUsers={}, totalUniqueUsers={}, dailyTransactionCount={}", 
        [
            usageMetrics.id,
            usageMetrics.activeUsers.toString(),
            usageMetrics.totalUniqueUsers.toString(),
            usageMetrics.dailyTransactionCount.toString(),
        ]
    );

    return usageMetrics;
  }

  export function getTokenAmountUSD(tokenAddress: Address, tokenAmount: BigInt): BigDecimal {
    /* 
        Get the price of the token from the oracle as a BigInt with 18 decimals. 
        Convert token price to BigDecimal using 18 decimals.
        Convert token amount to BigDecimal using the contract decimals.
        Multiply them, then truncate to 2 decimals places to get price in USD.

        eg. for a gETH transaction
        tokenPrice = 3007540000000000000000
        tokenAmount = 3361871152102563403
        tokenAmountUSD = (token_price / 1e18) * (token_amount / 1e18) = 10110.961964794544
        tokenAmountUSD.truncate(2) = 10110.96
    */
    let tokenPrice = getTokenPrice(tokenAddress);
    let tokenContract = TokenContract.bind(tokenAddress)
    let tokenAmountBD = convertTokenToDecimal(tokenAmount, tokenContract.decimals());
    let tokenPriceBD = convertTokenToDecimal(tokenPrice, BigInt.fromI32(18));
    let tokenAmountUSD = tokenAmountBD.times(tokenPriceBD).truncate(2);
    log.warning("{} {} (${}) transferred", [tokenAmountBD.truncate(2).toString(), tokenContract.symbol(), tokenAmountUSD.toString()]);
    return tokenAmountUSD
  }

  export function getFinancialSnapshot(
      timestamp: BigInt,
      tokenAmount: BigInt,
      tokenAddress: Address,
      transactionFee: BigInt,
      rate: BigInt,
      interactionType: string,
  ): FinancialsDailySnapshotEntity {

    let id: i64 = timestamp.toI64() / SECONDS_PER_DAY;

    // Refresh id daily, historical snapshots can be accessed by using the id
    let financialsDailySnapshot = FinancialsDailySnapshotEntity.load(id.toString())
  
    // Initialize all daily snapshot values
    if (!financialsDailySnapshot) {
      log.warning("Initializing financialsDailySnapshot with ID={}", [id.toString()]);
      financialsDailySnapshot =  new FinancialsDailySnapshotEntity(id.toString());
      financialsDailySnapshot.id = id.toString();
      financialsDailySnapshot.totalValueLockedUSD = ZERO_BD;
      financialsDailySnapshot.totalVolumeUSD = ZERO_BD;
      financialsDailySnapshot.supplySideRevenueUSD = ZERO_BD;
      financialsDailySnapshot.protocolSideRevenueUSD = ZERO_BD;
      financialsDailySnapshot.feesUSD = ZERO_BD;
    }

    let tokenAmountUSD = getTokenAmountUSD(tokenAddress, tokenAmount);

    if (interactionType == DEPOSIT_INTERACTION) {
        // Add value locked for operations like depositing
        financialsDailySnapshot.totalValueLockedUSD = financialsDailySnapshot.totalValueLockedUSD.plus(tokenAmountUSD);
    }
    else if (interactionType == BORROW_INTERACTION) {
        // Add value locked for operations like borrow (temporary for testing)
        financialsDailySnapshot.totalValueLockedUSD = financialsDailySnapshot.totalValueLockedUSD.plus(tokenAmountUSD);
        let protocolSideRevenueUSD = bigIntToPercentage(rate).times(tokenAmountUSD);
        financialsDailySnapshot.protocolSideRevenueUSD = financialsDailySnapshot.protocolSideRevenueUSD.plus(protocolSideRevenueUSD);
    }
    else if (interactionType == WITHDRAW_INTERACTION) {
        // Subtract value locked for operations like withdrawing
        financialsDailySnapshot.totalValueLockedUSD = financialsDailySnapshot.totalValueLockedUSD.minus(tokenAmountUSD);
    }
    else if (interactionType == REWARD_INTERACTION) {
        // Add supply revenue for rewards
        financialsDailySnapshot.supplySideRevenueUSD = financialsDailySnapshot.supplySideRevenueUSD.plus(tokenAmountUSD);
    }
    else if (interactionType == REPAY_INTERACTION) {
        // Add supply revenue for rewards
        financialsDailySnapshot.totalValueLockedUSD = financialsDailySnapshot.totalValueLockedUSD.plus(tokenAmountUSD);
    }
    else if (interactionType == STAKE_INTERACTION) {
        financialsDailySnapshot.totalValueLockedUSD = financialsDailySnapshot.totalValueLockedUSD.plus(tokenAmountUSD);
    }
    else if (interactionType == UNSTAKE_INTERACTION) {
        financialsDailySnapshot.totalValueLockedUSD = financialsDailySnapshot.totalValueLockedUSD.minus(tokenAmountUSD);
    }
    else {
        log.error("Invalid interaction type {}", [interactionType])
    }

    // Volume is counted for all interactions
    financialsDailySnapshot.totalVolumeUSD = financialsDailySnapshot.totalVolumeUSD.plus(tokenAmountUSD)
    financialsDailySnapshot.feesUSD = financialsDailySnapshot.feesUSD.plus(getTokenAmountUSD(TOKEN_ADDRESS_WFTM, transactionFee))
    financialsDailySnapshot.timestamp = timestamp;

    log.warning(
        "Adding to FinancialsDailySnapshot with ID={}. InteractionType={} (${}). totalValueLockedUSD={}, totalVolumeUSD={}, supplySideRevenueUSD={}, protocolSideRevenueUSD={}, feesUSD={}", 
        [
            financialsDailySnapshot.id, 
            interactionType,
            tokenAmountUSD.toString(),
            financialsDailySnapshot.totalValueLockedUSD.toString(), 
            financialsDailySnapshot.totalVolumeUSD.toString(), 
            financialsDailySnapshot.supplySideRevenueUSD.toString(),
            financialsDailySnapshot.protocolSideRevenueUSD.toString(),
            financialsDailySnapshot.feesUSD.toString()
        ]
    )

    return financialsDailySnapshot;
  }

  export function getTokenPrice(tokenAddress: Address) : BigInt {
    /* 
        The price oracle only supports a limited number of tokens
        So map the gTokens to the underlying asset for price
        eg. gUSDC -> USDC, gDAI -> DAI etc.
    */

    let priceOracle = AaveOracle.bind(PRICE_ORACLE);

    if ((tokenAddress == TOKEN_ADDRESS_gfUSDT) || (tokenAddress == TOKEN_ADDRESS_fUSDT)) {
        return priceOracle.getAssetPrice(TOKEN_ADDRESS_fUSDT);
    }
    else if ((tokenAddress == TOKEN_ADDRESS_gUSDC) || (tokenAddress == TOKEN_ADDRESS_USDC)) {
        return priceOracle.getAssetPrice(TOKEN_ADDRESS_USDC);
    }
    else if ((tokenAddress == TOKEN_ADDRESS_gDAI) || (tokenAddress == TOKEN_ADDRESS_DAI)) {
        return priceOracle.getAssetPrice(TOKEN_ADDRESS_DAI);
    }
    else if ((tokenAddress == TOKEN_ADDRESS_gMIM) || (tokenAddress == TOKEN_ADDRESS_MIM)) {    
        return priceOracle.getAssetPrice(TOKEN_ADDRESS_MIM);
    }
    else if (tokenAddress == TOKEN_ADDRESS_GEIST) {
        /* 
            For the GEIST token, the price is derived from the
            ratio of FTM-GEIST reserves on Spookyswap multiplied by
            the price of WFTM from the oracle
        */
        let geistFtmLP = SpookySwapGEISTFTM.bind(GEIST_FTM_LP_ADDRESS);

        let reserveFTM = geistFtmLP.getReserves().value0;
        let reserveGEIST = geistFtmLP.getReserves().value1;

        let priceGEISTinFTM = reserveFTM.div(reserveGEIST);

        let priceFTMinUSD = priceOracle.getAssetPrice(TOKEN_ADDRESS_WFTM);        
        return priceGEISTinFTM.times(priceFTMinUSD)
    }
    else if ((tokenAddress == TOKEN_ADDRESS_gWBTC) || (tokenAddress == TOKEN_ADDRESS_BTC)) {
        return priceOracle.getAssetPrice(TOKEN_ADDRESS_BTC);
    }
    else if ((tokenAddress == TOKEN_ADDRESS_gLINK) || (tokenAddress == TOKEN_ADDRESS_LINK)) {
        return priceOracle.getAssetPrice(TOKEN_ADDRESS_LINK);
    }
    else if ((tokenAddress == TOKEN_ADDRESS_gCRV) || (tokenAddress == TOKEN_ADDRESS_CRV)) {
        return priceOracle.getAssetPrice(TOKEN_ADDRESS_CRV);
    }
    else if ((tokenAddress == TOKEN_ADDRESS_gETH) || (tokenAddress == TOKEN_ADDRESS_ETH)) {
        return priceOracle.getAssetPrice(TOKEN_ADDRESS_ETH);
    }
    else if ((tokenAddress == TOKEN_ADDRESS_gFTM) || (tokenAddress == TOKEN_ADDRESS_WFTM)) {
        return priceOracle.getAssetPrice(TOKEN_ADDRESS_WFTM);
    }
    else {
        log.error("Invalid token address {}, cannot get price from oracle", [tokenAddress.toHexString()])
        return BigInt.fromI32(0);
    }
}

export function handleOwnershipTransferred(event: OwnershipTransferred): void {
    // Placeholder
}

export function handleTransfer(event: Transfer): void {
    // Placeholder
}
