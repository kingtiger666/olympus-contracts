const chai = require("chai");
const { assert, expect } = require("chai");
const { olympus } = require("../utils/olympus");
const { solidity } = require("ethereum-waffle");
const { increase } = require("../utils/advancement");
const { fork_network } = require("../utils/network_fork");
const impersonateAccount = require("../utils/impersonate_account");

chai.use(solidity);

const gOhmHolderAddress = "0xD3D086B36d5502122F275F4Bc18e04c844Bd6E2e";
const sOhmHolderAddress = "0xa8b4bcB15382641574822214771b7f05a3e0B408";
const daiHolderAddress = "0x1B7BAa734C00298b9429b518D621753Bb0f6efF2";

describe("IncurDebt", async () => {
    let user,
        amount,
        factory,
        staking,
        governor,
        treasury,
        ohm_token,
        uniRouter,
        daiHolder,
        gohm_token,
        sohm_token,
        gOhmHolder,
        sOhmHolder,
        IncurDebt,
        incurDebt,
        daiContract,
        amountInSOHM,
        UniSwapStrategy,
        uniSwapStrategy,
        halfOfTotalDeposit;

    beforeEach(async () => {
        await fork_network(14565910);
        [user] = await ethers.getSigners();

        amount = "2000000000000";
        amountInSOHM = "1000000000000";
        halfOfTotalDeposit = `${1000000000000 / 2}`;

        uniRouter = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
        factory = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";

        IncurDebt = await ethers.getContractFactory("IncurDebt");
        incurDebt = await IncurDebt.deploy(
            olympus.ohm,
            olympus.sohm,
            olympus.staking,
            olympus.treasury,
            olympus.authority
        );

        UniSwapStrategy = await ethers.getContractFactory("UniSwapStrategy");
        uniSwapStrategy = await UniSwapStrategy.deploy(
            uniRouter,
            factory,
            incurDebt.address,
            olympus.ohm
        );

        daiContract = await ethers.getContractAt(
            "contracts/interfaces/IERC20.sol:IERC20",
            "0x6B175474E89094C44Da98b954EedeAC495271d0F"
        );

        treasury = await ethers.getContractAt("OlympusTreasury", olympus.treasury);

        governor = await impersonate(olympus.governor);
        gOhmHolder = await impersonate(gOhmHolderAddress);
        sOhmHolder = await impersonate(sOhmHolderAddress);
        daiHolder = await impersonate(daiHolderAddress);

        ohm_token = await getContract("IOHM", olympus.ohm);
        gohm_token = await getContract("IgOHM", olympus.gohm);
        staking = await getContract("OlympusStaking", olympus.staking);
        sohm_token = await getContract("sOlympus", olympus.sohm);

        await treasury.connect(governor).enable(10, incurDebt.address, incurDebt.address);

        await treasury.connect(governor).enable(9, olympus.sohm, olympus.sohm);

        await user.sendTransaction({
            to: sOhmHolder.address,
            value: ethers.utils.parseEther("2"), // 2 ether
        });
    });

    describe("setGlobalDebtLimit(uint256 _limit)", () => {
        const amount = "2000000000000";

        it("Should fail if caller is not governor  address", async () => {
            await expect(incurDebt.connect(user).setGlobalDebtLimit(amount)).to.revertedWith(
                "UNAUTHORIZED()"
            );
        });

        it("Should set global debt limit address", async () => {
            await expect(incurDebt.connect(governor).setGlobalDebtLimit(amount))
                .to.emit(incurDebt, "GlobalLimitChanged")
                .withArgs(amount);
            assert.equal(await incurDebt.globalDebtLimit(), amount);
        });
    });

    describe("allowBorrower(address _borrower)", () => {
        it("Should fail if caller is not governor  address", async () => {
            await expect(
                incurDebt.connect(user).allowBorrower(gOhmHolder.address, false, true)
            ).to.revertedWith("UNAUTHORIZED()");
        });

        it("Should fail if isNonLpBorrower and isLpBorrower is true", async () => {
            await expect(
                incurDebt.connect(governor).allowBorrower(gOhmHolder.address, true, true)
            ).to.revertedWith("IncurDebt_BothParamsCannotBeTrue()");
        });

        it("Should fail if user is already a type of borrower", async () => {
            await incurDebt.connect(governor).allowBorrower(sOhmHolder.address, false, true);
            await expect(
                incurDebt.connect(governor).allowBorrower(sOhmHolder.address, true, false)
            ).to.revertedWith(`IncurDebt_AlreadyBorrower("${sOhmHolder.address}")`);
        });

        it("Should allow borrower", async () => {
            const borrowerInfoBeforerTx = await incurDebt.borrowers(sOhmHolder.address);
            assert.equal(borrowerInfoBeforerTx.isNonLpBorrower, false);

            await expect(incurDebt.connect(governor).allowBorrower(sOhmHolder.address, false, true))
                .to.emit(incurDebt, "BorrowerAllowed")
                .withArgs(sOhmHolder.address, false, true);

            const borrowerInfoAfterTx = await incurDebt.borrowers(sOhmHolder.address);
            assert.equal(borrowerInfoAfterTx.isNonLpBorrower, true);
        });
    });

    describe("setBorrowerDebtLimit(address _borrower, uint256 _limit)", () => {
        const amount = "2000000000000";
        it("Should fail if caller is not governor  address", async () => {
            await expect(
                incurDebt.connect(user).setBorrowerDebtLimit(gOhmHolder.address, amount)
            ).to.revertedWith("UNAUTHORIZED()");
        });

        it("Should fail if _borrower is not borrower", async () => {
            await expect(
                incurDebt.connect(governor).setBorrowerDebtLimit(user.address, amount)
            ).to.revertedWith(`IncurDebt_NotBorrower("${user.address}")`);
        });

        it("Should fail if _limit above global debt limit", async () => {
            await incurDebt.connect(governor).allowBorrower(gOhmHolder.address, false, true);
            await expect(
                incurDebt.connect(governor).setBorrowerDebtLimit(gOhmHolder.address, amount)
            ).to.revertedWith(`IncurDebt_AboveGlobalDebtLimit(${amount})`);
        });

        it("Should set borrower debt limit", async () => {
            const _amount = "1000000000000";
            await incurDebt.connect(governor).setGlobalDebtLimit(amount);

            await incurDebt.connect(governor).allowBorrower(sOhmHolder.address, false, true);
            const borrowerInfoBeforeTx = await incurDebt.borrowers(sOhmHolder.address);

            assert.equal(borrowerInfoBeforeTx.limit, 0);
            await expect(
                incurDebt.connect(governor).setBorrowerDebtLimit(sOhmHolder.address, _amount)
            )
                .to.emit(incurDebt, "BorrowerDebtLimitSet")
                .withArgs(sOhmHolder.address, _amount);

            const borrowerInfoAfterTx = await incurDebt.borrowers(sOhmHolder.address);
            assert.equal(borrowerInfoAfterTx.limit, _amount);
        });
    });

    describe("revokeBorrower(address _borrower)", () => {
        it("Should fail if caller is not governor address", async () => {
            await expect(
                incurDebt.connect(user).revokeBorrower(gOhmHolder.address, false, true)
            ).to.revertedWith("UNAUTHORIZED()");
        });

        it("Should fail if _borrower is not borrower", async () => {
            await expect(
                incurDebt.connect(governor).revokeBorrower(user.address, false, true)
            ).to.revertedWith(`IncurDebt_NotBorrower("${user.address}")`);
        });

        it("Should fail if isNonLpBorrower and isLpBorrower is true", async () => {
            await incurDebt.connect(governor).allowBorrower(sOhmHolder.address, false, true);
            await expect(
                incurDebt.connect(governor).revokeBorrower(sOhmHolder.address, true, true)
            ).to.revertedWith("IncurDebt_BothParamsCannotBeTrue()");
        });

        it("Should allow to revoke borrower", async () => {
            await incurDebt.connect(governor).allowBorrower(sOhmHolder.address, false, true);
            const borrowerInfoBeforeTx = await incurDebt.borrowers(sOhmHolder.address);

            assert.equal(borrowerInfoBeforeTx.isNonLpBorrower, true);
            await expect(
                incurDebt.connect(governor).revokeBorrower(sOhmHolder.address, false, true)
            )
                .to.emit(incurDebt, "BorrowerRevoked")
                .withArgs(sOhmHolder.address, false, true);

            const borrowerInfoAfterTx = await incurDebt.borrowers(sOhmHolder.address);
            assert.equal(borrowerInfoAfterTx.isNonLpBorrower, false);
        });
    });

    describe("deposit(uint256 _amount)", () => {
        it("Should fail if _borrower is not borrower", async () => {
            await expect(incurDebt.connect(user).deposit(amount)).to.revertedWith(
                `IncurDebt_NotBorrower("${user.address}")`
            );
        });

        it("Should fail if _borrower has no fund", async () => {
            await incurDebt.connect(governor).setGlobalDebtLimit(amount);
            await incurDebt.connect(governor).allowBorrower(gOhmHolder.address, false, true);

            await incurDebt.connect(governor).setBorrowerDebtLimit(gOhmHolder.address, amount);

            await gohm_token.connect(gOhmHolder).approve(incurDebt.address, amount);

            await expect(incurDebt.connect(gOhmHolder).deposit(amount)).to.revertedWith(
                `TRANSFER_FROM_FAILED`
            );
        });

        it("Should deposit sohm", async () => {
            await incurDebt.connect(governor).setGlobalDebtLimit(amount);
            await incurDebt.connect(governor).allowBorrower(sOhmHolder.address, false, true);

            await incurDebt
                .connect(governor)
                .setBorrowerDebtLimit(sOhmHolder.address, amountInSOHM);

            await sohm_token.connect(sOhmHolder).approve(incurDebt.address, amount);
            const borrowerInfoBeforeTx = await incurDebt.borrowers(sOhmHolder.address);

            assert.equal(borrowerInfoBeforeTx.collateralInSOHM, 0);
            await expect(incurDebt.connect(sOhmHolder).deposit(amountInSOHM))
                .to.emit(incurDebt, "BorrowerDeposit")
                .withArgs(sOhmHolder.address, olympus.sohm, amountInSOHM);

            const borrowerInfoAfterTx = await incurDebt.borrowers(sOhmHolder.address);
            assert.equal(borrowerInfoAfterTx.collateralInSOHM, amountInSOHM);
        });
    });

    describe("borrow(uint256 _ohmAmount)", () => {
        it("Should fail if _borrower is not borrower", async () => {
            await expect(incurDebt.connect(user).borrow(amount)).to.revertedWith(
                `IncurDebt_NotBorrower("${user.address}")`
            );
        });

        it("Should fail if amount to borrow is above borrowers debt limit", async () => {
            await incurDebt.connect(governor).setGlobalDebtLimit(amount);
            await incurDebt.connect(governor).allowBorrower(sOhmHolder.address, false, true);

            await incurDebt
                .connect(governor)
                .setBorrowerDebtLimit(sOhmHolder.address, amountInSOHM);
            await expect(incurDebt.connect(sOhmHolder).borrow(amount)).to.revertedWith(
                `IncurDebt_AboveBorrowersDebtLimit(2000000000000)`
            );
        });

        it("Should fail if borrowers available debt is below amount", async () => {
            await incurDebt.connect(governor).setGlobalDebtLimit(amount);
            await incurDebt.connect(governor).allowBorrower(sOhmHolder.address, false, true);

            await incurDebt.connect(governor).setBorrowerDebtLimit(sOhmHolder.address, amount);
            await expect(incurDebt.connect(sOhmHolder).borrow(amountInSOHM)).to.revertedWith(
                `IncurDebt_OHMAmountMoreThanAvailableLoan(1000000000000)`
            );
        });

        it("Should borrow", async () => {
            await setUp(amountInSOHM, sOhmHolder.address, sOhmHolder, sohm_token);
            await treasury.connect(governor).setDebtLimit(incurDebt.address, amount);

            const borrowerInfoBeforeTx = await incurDebt.borrowers(sOhmHolder.address);
            assert.equal(borrowerInfoBeforeTx.debt, 0);

            const outstandingDebtBeforeTx = await incurDebt.totalOutstandingGlobalDebt();
            assert.equal(outstandingDebtBeforeTx, 0);

            const ohmBalanceBeforeTx = await ohm_token.balanceOf(sOhmHolder.address);
            assert.equal(ohmBalanceBeforeTx, 0);

            await expect(incurDebt.connect(sOhmHolder).borrow(amountInSOHM))
                .to.emit(incurDebt, "Borrowed")
                .withArgs(
                    sOhmHolder.address,
                    amountInSOHM,
                    Number(amountInSOHM) + Number(borrowerInfoBeforeTx.debt),
                    Number(outstandingDebtBeforeTx) + Number(amountInSOHM)
                );
            const borrowerInfoAfterTx = await incurDebt.borrowers(sOhmHolder.address);

            const ohmBalanceAfterTx = await ohm_token.balanceOf(sOhmHolder.address);
            assert.equal(ohmBalanceAfterTx, amountInSOHM);

            assert.equal(borrowerInfoAfterTx.debt, amountInSOHM);
            const outstandingDebtAfterTx = await incurDebt.totalOutstandingGlobalDebt();

            assert.equal(outstandingDebtAfterTx, amountInSOHM);
        });

        it("Should fail to revoke borrower", async () => {
            await setUp(amountInSOHM, sOhmHolder.address, sOhmHolder, sohm_token);
            await treasury.connect(governor).setDebtLimit(incurDebt.address, amount);

            await incurDebt.connect(sOhmHolder).borrow(amountInSOHM);

            await expect(
                incurDebt.connect(governor).revokeBorrower(sOhmHolder.address, false, true)
            ).to.revertedWith(`IncurDebt_BorrowerStillHasOutstandingDebt("${sOhmHolder.address}")`);
        });

        it("Should fail if borrower debt limit is above limit", async () => {
            await setUp(amountInSOHM, sOhmHolder.address, sOhmHolder, sohm_token);
            await treasury.connect(governor).setDebtLimit(incurDebt.address, amount);

            await incurDebt.connect(sOhmHolder).borrow(amountInSOHM);

            await expect(
                incurDebt.connect(governor).setBorrowerDebtLimit(sOhmHolder.address, "900000000000")
            ).to.revertedWith(`IncurDebt_AboveBorrowersDebtLimit(${900000000000})`);
        });

        it("Should fail if total outstanding debt is > limit", async () => {
            await setUp(amountInSOHM, sOhmHolder.address, sOhmHolder, sohm_token);
            await treasury.connect(governor).setDebtLimit(incurDebt.address, amount);

            await incurDebt.connect(sOhmHolder).borrow(amountInSOHM);

            await expect(
                incurDebt.connect(governor).setGlobalDebtLimit("900000000000")
            ).to.revertedWith(`IncurDebt_LimitBelowOutstandingDebt(${900000000000})`);
        });
    });

    describe("withdraw(uint256 _amount,address _to)", () => {
        it("Should fail if _borrower is not borrower", async () => {
            await expect(incurDebt.connect(user).withdraw(amount, user.address)).to.revertedWith(
                `IncurDebt_NotBorrower("${user.address}")`
            );
        });

        it("Should fail if _amount is 0", async () => {
            await incurDebt.connect(governor).allowBorrower(user.address, false, true);
            await expect(incurDebt.connect(user).withdraw(0, user.address)).to.revertedWith(
                `IncurDebt_InvaildNumber(${0})`
            );
        });

        it("Should fail if below borrower sOHM balance", async () => {
            await incurDebt.connect(governor).allowBorrower(user.address, false, true);
            await expect(incurDebt.connect(user).withdraw(amount, user.address)).to.revertedWith(
                `IncurDebt_AmountAboveBorrowerBalance(${amount})`
            );
        });

        it("Should fail if available collateral is tied to outstanding debt", async () => {
            await setUp(amountInSOHM, sOhmHolder.address, sOhmHolder, sohm_token);
            await treasury.connect(governor).setDebtLimit(incurDebt.address, amount);

            await incurDebt.connect(sOhmHolder).borrow("500000000000");

            await expect(
                incurDebt.connect(sOhmHolder).withdraw("500000000001", gOhmHolder.address)
            ).to.revertedWith(`IncurDebt_AmountAboveBorrowerBalance(${500000000001})`);
        });

        it("Should withdraw borrowers sOHM balance", async () => {
            await setUp(amountInSOHM, sOhmHolder.address, sOhmHolder, sohm_token);
            const availableToBorrowBeforeTx = await incurDebt
                .connect(sOhmHolder)
                .getAvailableToBorrow();

            await increase(28800); //8 hours;
            await staking.connect(sOhmHolder).rebase();

            const availableToBorrowAfterTx = await incurDebt
                .connect(sOhmHolder)
                .getAvailableToBorrow();
            expect(availableToBorrowAfterTx).to.be.above(availableToBorrowBeforeTx);

            const sOhmBanlanceBeforeTx = await sohm_token.balanceOf(sOhmHolder.address);
            await expect(incurDebt.connect(sOhmHolder).withdraw(amountInSOHM, sOhmHolder.address))
                .to.emit(incurDebt, "Withdrawal")
                .withArgs(
                    sOhmHolder.address,
                    olympus.sohm,
                    sOhmHolder.address,
                    amountInSOHM,
                    Number(availableToBorrowAfterTx) - amountInSOHM
                );

            const sOhmBanlanceAfterTx = await sohm_token.balanceOf(sOhmHolder.address);
            assert.equal(
                (Number(sOhmBanlanceBeforeTx) + Number(amountInSOHM)).toString(),
                Number(sOhmBanlanceAfterTx).toString()
            );

            const borrowerInfo = await incurDebt.borrowers(sOhmHolder.address);
            assert.equal(
                Number(borrowerInfo.collateralInSOHM),
                Number(availableToBorrowAfterTx) - amountInSOHM
            );
        });

        it("Should withdraw borrower sOHM available balance ", async () => {
            await setUp(amountInSOHM, sOhmHolder.address, sOhmHolder, sohm_token);
            await treasury.connect(governor).setDebtLimit(incurDebt.address, amount);

            await incurDebt.connect(sOhmHolder).borrow(halfOfTotalDeposit);
            const borrowerInfobeforeTx = await incurDebt.borrowers(sOhmHolder.address);

            assert.equal(Number(borrowerInfobeforeTx.collateralInSOHM), Number(amountInSOHM));

            const sOhmBanlanceBeforeTx = await sohm_token.balanceOf(sOhmHolder.address);
            const currentCollateral =
                Number(borrowerInfobeforeTx.collateralInSOHM) - Number(halfOfTotalDeposit);

            await expect(
                incurDebt.connect(sOhmHolder).withdraw(halfOfTotalDeposit, sOhmHolder.address)
            )
                .to.emit(incurDebt, "Withdrawal")
                .withArgs(
                    sOhmHolder.address,
                    olympus.sohm,
                    sOhmHolder.address,
                    halfOfTotalDeposit,
                    `${currentCollateral}`
                );

            const sOhmBanlanceAfterTx = await sohm_token.balanceOf(sOhmHolder.address);

            assert.equal(
                (Number(sOhmBanlanceBeforeTx) + currentCollateral).toString(),
                sOhmBanlanceAfterTx.toString()
            );

            const borrowerInfo = await incurDebt.borrowers(sOhmHolder.address);
            assert.equal(Number(borrowerInfo.collateralInSOHM), Number(halfOfTotalDeposit));

            assert.equal(Number(borrowerInfo.collateralInSOHM), Number(borrowerInfo.debt));
        });
    });

    describe("repayDebtWithCollateral()", () => {
        it("Should fail if _borrower is not borrower", async () => {
            await expect(incurDebt.connect(sOhmHolder).repayDebtWithCollateral()).to.revertedWith(
                `IncurDebt_NotBorrower("${sOhmHolder.address}")`
            );
        });

        it("Should fail if _borrower has no debt", async () => {
            await incurDebt.connect(governor).allowBorrower(sOhmHolder.address, false, true);
            await expect(incurDebt.connect(sOhmHolder).repayDebtWithCollateral()).to.revertedWith(
                `IncurDebt_BorrowerHasNoOutstandingDebt("${sOhmHolder.address}")`
            );
        });

        it("Should allow borrower pay debt with collateral", async () => {
            await setUp(amountInSOHM, sOhmHolder.address, sOhmHolder, sohm_token);
            await treasury.connect(governor).setDebtLimit(incurDebt.address, amount);

            await incurDebt.connect(sOhmHolder).borrow(halfOfTotalDeposit);
            const totalDebtBeforeTx = await incurDebt.totalOutstandingGlobalDebt();

            assert.equal(Number(totalDebtBeforeTx), Number(halfOfTotalDeposit));
            const borrowerInfoBeforeTx = await incurDebt.borrowers(sOhmHolder.address);

            assert.equal(Number(borrowerInfoBeforeTx.collateralInSOHM), Number(amountInSOHM));

            await expect(incurDebt.connect(sOhmHolder).repayDebtWithCollateral())
                .to.emit(incurDebt, "DebtPaidWithCollateral")
                .withArgs(
                    sOhmHolder.address,
                    halfOfTotalDeposit,
                    Number(borrowerInfoBeforeTx.collateralInSOHM) - Number(halfOfTotalDeposit),
                    Number(borrowerInfoBeforeTx.debt) - Number(halfOfTotalDeposit),
                    Number(totalDebtBeforeTx) - Number(halfOfTotalDeposit)
                );
            const totalDebtAfterTx = await incurDebt.totalOutstandingGlobalDebt();

            assert.equal(Number(totalDebtAfterTx), 0);
            const borrowerInfoAfterTx = await incurDebt.borrowers(sOhmHolder.address);

            assert.equal(Number(borrowerInfoAfterTx.debt), 0);
            assert.equal(Number(borrowerInfoAfterTx.collateralInSOHM), Number(halfOfTotalDeposit));
        });
    });

    describe("repayDebtWithCollateralAndWithdrawTheRest()", () => {
        it("Should fail if _borrower is not borrower", async () => {
            await expect(
                incurDebt.connect(user).repayDebtWithCollateralAndWithdrawTheRest()
            ).to.revertedWith(`IncurDebt_NotBorrower("${user.address}")`);
        });

        it("Should fail if _borrower has no debt", async () => {
            await incurDebt.connect(governor).allowBorrower(sOhmHolder.address, false, true);
            await expect(
                incurDebt.connect(sOhmHolder).repayDebtWithCollateralAndWithdrawTheRest()
            ).to.revertedWith(`IncurDebt_BorrowerHasNoOutstandingDebt("${sOhmHolder.address}")`);
        });

        it("Should allow borrower pay debt with collateral withdraw the rest to sOHM", async () => {
            await setUp(amountInSOHM, sOhmHolder.address, sOhmHolder, sohm_token);
            await treasury.connect(governor).setDebtLimit(incurDebt.address, amount);

            await incurDebt.connect(sOhmHolder).borrow(halfOfTotalDeposit);
            const totalDebtBeforeTx = await incurDebt.totalOutstandingGlobalDebt();

            assert.equal(Number(totalDebtBeforeTx), halfOfTotalDeposit);
            const borrowerInfoBeforeTx = await incurDebt.borrowers(sOhmHolder.address);

            assert.equal(Number(borrowerInfoBeforeTx.collateralInSOHM), amountInSOHM);

            await expect(incurDebt.connect(sOhmHolder).repayDebtWithCollateralAndWithdrawTheRest())
                .to.emit(incurDebt, "DebtPaidWithCollateralAndWithdrawTheRest")
                .withArgs(
                    sOhmHolder.address,
                    halfOfTotalDeposit,
                    Number(borrowerInfoBeforeTx.collateralInSOHM) - Number(amountInSOHM),
                    Number(borrowerInfoBeforeTx.debt) - Number(halfOfTotalDeposit),
                    Number(totalDebtBeforeTx) - Number(halfOfTotalDeposit),
                    Number(borrowerInfoBeforeTx.collateralInSOHM) - Number(halfOfTotalDeposit)
                );

            const totalDebtAfterTx = await incurDebt.totalOutstandingGlobalDebt();

            assert.equal(Number(totalDebtAfterTx), 0);
            const borrowerInfoAfterTx = await incurDebt.borrowers(gOhmHolder.address);

            assert.equal(Number(borrowerInfoAfterTx.collateralInSOHM), 0);
            assert.equal(Number(borrowerInfoAfterTx.debt), 0);
        });
    });

    describe("repayDebtWithOHM(uint256 _ohmAmount)", () => {
        it("Should fail if _borrower is not borrower", async () => {
            await expect(incurDebt.connect(user).repayDebtWithOHM(amount)).to.revertedWith(
                `IncurDebt_NotBorrower("${user.address}")`
            );
        });

        it("Should fail if _borrower has no debt", async () => {
            await incurDebt.connect(governor).allowBorrower(gOhmHolder.address, false, true);
            await expect(
                incurDebt.connect(gOhmHolder).repayDebtWithOHM("500000000000")
            ).to.revertedWith(`IncurDebt_BorrowerHasNoOutstandingDebt("${gOhmHolder.address}")`);
        });

        it("Should allow borrower pay debt with OHM", async () => {
            await setUp(amountInSOHM, sOhmHolder.address, sOhmHolder, sohm_token);
            await treasury.connect(governor).setDebtLimit(incurDebt.address, amount);

            await incurDebt.connect(sOhmHolder).borrow("500000000000");
            const borrowerInfoBeforeTx = await incurDebt.borrowers(sOhmHolder.address);

            assert.equal(Number(borrowerInfoBeforeTx.debt), 500000000000);
            const totalDebtBeforeTx = await incurDebt.totalOutstandingGlobalDebt();

            assert.equal(Number(totalDebtBeforeTx), 500000000000);

            const userOhmBalanceBeforeTx = await ohm_token.balanceOf(sOhmHolder.address);
            assert.equal(Number(userOhmBalanceBeforeTx), 500000000000);

            await ohm_token.connect(sOhmHolder).approve(incurDebt.address, amount);
            await expect(incurDebt.connect(sOhmHolder).repayDebtWithOHM(500000000000))
                .to.emit(incurDebt, "DebtPaidWithOHM")
                .withArgs(
                    sOhmHolder.address,
                    "500000000000",
                    Number(borrowerInfoBeforeTx.debt) - 500000000000,
                    Number(totalDebtBeforeTx) - 500000000000
                );

            const userOhmBalanceAfterTx = await ohm_token.balanceOf(sOhmHolder.address);
            assert.equal(Number(userOhmBalanceAfterTx), 0);

            const borrowerInfoAfterTx = await incurDebt.borrowers(sOhmHolder.address);
            const totalDebtAfterTx = await incurDebt.totalOutstandingGlobalDebt();

            assert.equal(Number(totalDebtAfterTx), 0);
            assert.equal(Number(borrowerInfoAfterTx.debt), 0);
        });
    });

    describe("forceRepay(address _borrower)", () => {
        it("Should fail if caller is not governor  address", async () => {
            await expect(incurDebt.connect(user).forceRepay(gOhmHolder.address)).to.revertedWith(
                "UNAUTHORIZED()"
            );
        });

        it("Should fail if _borrower is not borrower", async () => {
            await expect(
                incurDebt.connect(governor).forceRepay(gOhmHolder.address)
            ).to.revertedWith(`IncurDebt_NotBorrower("${gOhmHolder.address}")`);
        });

        it("Should fail if _borrower has no debt", async () => {
            await incurDebt.connect(governor).allowBorrower(gOhmHolder.address, false, true);
            await expect(
                incurDebt.connect(governor).forceRepay(gOhmHolder.address)
            ).to.revertedWith(`IncurDebt_BorrowerHasNoOutstandingDebt("${gOhmHolder.address}")`);
        });

        it("Should allow gov force payment", async () => {
            await setUp(amountInSOHM, sOhmHolder.address, sOhmHolder, sohm_token);
            await treasury.connect(governor).setDebtLimit(incurDebt.address, amount);

            await incurDebt.connect(sOhmHolder).borrow("500000000000");
            const borrowerInfoBeforeTx = await incurDebt.borrowers(sOhmHolder.address);

            assert.equal(Number(borrowerInfoBeforeTx.debt), 500000000000);
            assert.equal(Number(borrowerInfoBeforeTx.collateralInSOHM), amountInSOHM);

            const totalDebtBeforeTx = await incurDebt.totalOutstandingGlobalDebt();

            assert.equal(Number(totalDebtBeforeTx), 500000000000);

            await expect(incurDebt.connect(governor).forceRepay(sOhmHolder.address))
                .to.emit(incurDebt, "ForceDebtPayWithCollateralAndWithdrawTheRest")
                .withArgs(
                    sOhmHolder.address,
                    "500000000000",
                    Number(borrowerInfoBeforeTx.collateralInSOHM) - 1000000000000,
                    Number(borrowerInfoBeforeTx.debt) - 500000000000,
                    Number(totalDebtBeforeTx) - 500000000000,
                    Number(borrowerInfoBeforeTx.collateralInSOHM) - 500000000000
                );

            const borrowerInfoAfterTx = await incurDebt.borrowers(sOhmHolder.address);
            const totalDebtAfterTx = await incurDebt.totalOutstandingGlobalDebt();

            assert.equal(Number(totalDebtAfterTx), 0);
            assert.equal(Number(borrowerInfoAfterTx.debt), 0);

            assert.equal(Number(borrowerInfoAfterTx.collateralInSOHM), 0);
        });
    });

    describe("seize(address _borrower)", () => {
        it("Should fail if caller is not governor  address", async () => {
            await expect(incurDebt.connect(user).seize(gOhmHolder.address)).to.revertedWith(
                "UNAUTHORIZED()"
            );
        });

        it("Should fail if _borrower is not borrower", async () => {
            await expect(incurDebt.connect(governor).seize(gOhmHolder.address)).to.revertedWith(
                `IncurDebt_NotBorrower("${gOhmHolder.address}")`
            );
        });

        it("Should fail if _borrower has no debt", async () => {
            await incurDebt.connect(governor).allowBorrower(gOhmHolder.address, false, true);
            await expect(incurDebt.connect(governor).seize(gOhmHolder.address)).to.revertedWith(
                `IncurDebt_BorrowerHasNoOutstandingDebt("${gOhmHolder.address}")`
            );
        });

        it("Should allow gov seize borrower collateral and pay debt", async () => {
            await setUp(amountInSOHM, sOhmHolder.address, sOhmHolder, sohm_token);
            await treasury.connect(governor).setDebtLimit(incurDebt.address, amount);

            await incurDebt.connect(sOhmHolder).borrow("500000000000");
            const borrowerInfoBeforeTx = await incurDebt.borrowers(sOhmHolder.address);

            assert.equal(Number(borrowerInfoBeforeTx.debt), 500000000000);
            assert.equal(Number(borrowerInfoBeforeTx.collateralInSOHM), 1000000000000);

            const totalDebtBeforeTx = await incurDebt.totalOutstandingGlobalDebt();

            assert.equal(Number(totalDebtBeforeTx), 500000000000);

            await expect(incurDebt.connect(governor).seize(sOhmHolder.address))
                .to.emit(incurDebt, "DebtPaidWithCollateralAndBurnTheRest")
                .withArgs(
                    sOhmHolder.address,
                    "500000000000",
                    Number(borrowerInfoBeforeTx.collateralInSOHM) - 1000000000000,
                    Number(borrowerInfoBeforeTx.debt) - 500000000000,
                    Number(totalDebtBeforeTx) - 500000000000,
                    Number(borrowerInfoBeforeTx.collateralInSOHM) - 500000000000
                );

            const borrowerInfoAfterTx = await incurDebt.borrowers(gOhmHolder.address);
            const totalDebtAfterTx = await incurDebt.totalOutstandingGlobalDebt();

            assert.equal(Number(totalDebtAfterTx), 0);
            assert.equal(Number(borrowerInfoAfterTx.debt), 0);

            assert.equal(Number(borrowerInfoAfterTx.collateralInSOHM), 0);
        });
    });

    describe("function createLP(_ohmAmount, _pairDesiredAmount, _strategy, _strategyParams)", () => {
        const ohmAmount = "33000000000";
        const daiAmount = "1000000000000000000000";
        const token0 = olympus.ohm;
        const token1 = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
        const slippage = 900;

        const data = ethers.utils.defaultAbiCoder.encode(
            ["address", "address", "uint256", "uint256", "uint256", "uint256", "uint256"],
            [token0, token1, ohmAmount, daiAmount, ohmAmount, daiAmount, slippage]
        );

        it("Should fail if borrower isNonLpBorrower", async () => {
            await incurDebt.connect(governor).allowBorrower(sOhmHolder.address, false, true);
            await incurDebt.connect(governor).whitelistStrategy(uniSwapStrategy.address);

            await expect(
                incurDebt
                    .connect(daiHolder)
                    .createLP(ohmAmount, daiAmount, uniSwapStrategy.address, data)
            ).to.revertedWith(`IncurDebt_NotBorrower("${daiHolder.address}")`);
        });

        it("Should fail if strategy is not whitelist", async () => {
            await incurDebt.connect(governor).allowBorrower(daiHolder.address, true, false);
            await expect(
                incurDebt
                    .connect(daiHolder)
                    .createLP(ohmAmount, daiAmount, uniSwapStrategy.address, data)
            ).to.revertedWith(`IncurDebt_StrategyUnauthorized("${uniSwapStrategy.address}")`);
        });

        it("Should fail if amount to borrow is above borrowers debt limit", async () => {
            await incurDebt.connect(governor).setGlobalDebtLimit(amount);
            await incurDebt.connect(governor).allowBorrower(daiHolder.address, true, false);

            await incurDebt
                .connect(governor)
                .setBorrowerDebtLimit(daiHolder.address, "20000000000");

            await incurDebt.connect(governor).whitelistStrategy(uniSwapStrategy.address);
            await expect(
                incurDebt
                    .connect(daiHolder)
                    .createLP(ohmAmount, daiAmount, uniSwapStrategy.address, data)
            ).to.revertedWith(`IncurDebt_AboveBorrowersDebtLimit(33000000000)`);
        });

        it("Should fail if borrowers available debt is below amount", async () => {
            await incurDebt.connect(governor).setGlobalDebtLimit(amount);
            await incurDebt.connect(governor).allowBorrower(daiHolder.address, true, false);

            await incurDebt.connect(governor).setBorrowerDebtLimit(daiHolder.address, ohmAmount);

            await incurDebt.connect(governor).whitelistStrategy(uniSwapStrategy.address);
            await expect(
                incurDebt
                    .connect(daiHolder)
                    .createLP(ohmAmount, daiAmount, uniSwapStrategy.address, data)
            ).to.revertedWith(`IncurDebt_OHMAmountMoreThanAvailableLoan(33000000000)`);
        });

        it("Should allow borrower create lp", async () => {
            await incurDebt.connect(governor).setGlobalDebtLimit(amount);
            await incurDebt.connect(governor).allowBorrower(daiHolder.address, true, false);

            await incurDebt.connect(governor).setBorrowerDebtLimit(daiHolder.address, ohmAmount);

            await sohm_token.connect(daiHolder).approve(incurDebt.address, amountInSOHM);
            await sohm_token.connect(sOhmHolder).transfer(daiHolder.address, amountInSOHM);

            await incurDebt.connect(daiHolder).deposit(amountInSOHM);
            await treasury.connect(governor).setDebtLimit(incurDebt.address, amount);

            await incurDebt.connect(governor).whitelistStrategy(uniSwapStrategy.address);
            await daiContract.connect(daiHolder).approve(uniSwapStrategy.address, daiAmount);
            await incurDebt
                .connect(daiHolder)
                .createLP(ohmAmount, daiAmount, uniSwapStrategy.address, data);
        });
    });

    async function impersonate(address) {
        await impersonateAccount(address);
        const owner = await ethers.getSigner(address);
        return owner;
    }

    async function getContract(contractSource, address) {
        const contract = await ethers.getContractAt(contractSource, address);
        return contract;
    }

    async function setUp(amountInToken, userAddress, signer, contract) {
        await incurDebt.connect(governor).setGlobalDebtLimit(amount);
        await incurDebt.connect(governor).allowBorrower(userAddress, false, true);

        await incurDebt.connect(governor).setBorrowerDebtLimit(userAddress, amountInToken);
        await contract.connect(signer).approve(incurDebt.address, amountInToken);

        await incurDebt.connect(signer).deposit(amountInToken);
    }
});