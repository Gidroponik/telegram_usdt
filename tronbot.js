const fs = require('fs');
const TelegramBot = require('node-telegram-bot-api');
const bodyParser = require('body-parser');
const TronWeb = require("tronweb");
const crypto = require("crypto");
const axios = require('axios');

const token = ''; // Ключ Телеграм Бота
let secretKey = ''; // Ваш Секретный ключ шифрования Файла [Запомните его, вы можете записать его прямо тут или же отправлять в сообщении при первом запуске программы]
const targetUserId = 0; // Ваш Telegram id (будут приниматься сообщения только от указанного пользователя).

const USDT_CONTRACT_ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"; // Адрес кошелька контракта для USDT (не менять) https://tronscan.org/#/token20/TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t/code 
const HttpProvider = TronWeb.providers.HttpProvider;
const fullNode = new HttpProvider('https://api.trongrid.io');
const solidityNode = new HttpProvider('https://api.trongrid.io');
const eventServer = 'https://api.trongrid.io';

// Создайте новый телеграм-бот
const bot = new TelegramBot(token, { polling: true });

// Временные переменные для хранения данных транзакции
let transferAmount = 0;
let recipientAddress = '';
let walletToDelete = '';
let walletToAction = '';
let pay_stage=0;
let lastMessageId = 0;
let type_send='';

// Обработка команды /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;

  transferAmount = 0;
  recipientAddress = '';
  walletToDelete = '';
  walletToAction = '';
  pay_stage=0;
  type_send='';

  if (chatId === targetUserId) {
    start_keys(chatId);
  }
});

bot.on('message', async (msg) => {
  const chatId = msg.chat.id;

  let access = await check_secret_key(chatId, msg);

  if (chatId === targetUserId && access) {
    if (msg.text === 'Список кошельков' || msg.text === 'Удалить кошелек') {
      const walletData = encryptAndDecrypt('wallets.json', secretKey, 'decrypt');
      let walletButtons;
      
      if (msg.text === 'Список кошельков') {
        walletButtons = walletData ? Object.keys(walletData).map((address) => [address]) : [];
      } else if (msg.text === 'Удалить кошелек') {
        walletButtons = Object.keys(walletData).map((address) => [`❌ ${address}`]);
      }

      walletButtons.push(['⬅️ Назад']); // Добавьте кнопку Назад

      const walletListOptions = {
        reply_markup: JSON.stringify({
          keyboard: walletButtons,
          resize_keyboard: true,
        }),
      };
      TgMessage(chatId, 'Выберите кошелек:', walletListOptions);
    }
    else if (msg.text === "Заблокировать бота"){
      secretKey='';
      TgMessage(chatId, 'Бот Заблокирован!');
    }
    else if (msg.text === '⬅️ Назад' || msg.text  === "Отмена") {
      transferAmount = 0;
      recipientAddress = '';
      walletToDelete = '';
      walletToAction = '';
      pay_stage=0;
      start_keys(chatId);
    }
    else if (msg.text === 'Создать кошелек'){
      let wallet = await generateWallet(secretKey);
      TgMessage(chatId, `Создан новый TRC кошелек\r\n<code>${wallet}</code>`);
    }
    else if (msg.text.startsWith('❌ ')) {
      walletToDelete = msg.text.substring(2) // Remove the '❌ ' prefix
      const confirmKeyboard = {
        reply_markup: JSON.stringify({
          keyboard: [['Да', 'Нет']],
          resize_keyboard: true,
        }),
      };

      const balances = await getTRONBalances(walletToDelete);
      TgMessage(chatId, `Вы точно хотите удалить кошелек \r\n<code>${walletToDelete}</code>\r\nUSDT Баланс: <b>${balances.usdt_balance}</b>$\r\nTRX Баланс: ${balances.tron_balance}`,confirmKeyboard );
    }
    else if (msg.text === 'Расшифровать Ключи') {
      if (walletToAction) {
        let wallet = await GetWallet(walletToAction);
        if (wallet) {
          let walletString = JSON.stringify(wallet, null, 2); // преобразование объекта в форматированную строку
          TgMessage(chatId, `<code>${walletString}</code>`);
        } else {
          TgMessage(chatId, 'Не удалось получить данные кошелька.');
        }
        start_keys(chatId);
      }
      else start_keys(chatId);
    }
    else if (msg.text === 'Перевести USDT') {
      TgMessage(chatId, "Введите сумму <b>USDT</b> для отправки:",{ parse_mode: 'HTML' });
      pay_stage=1;
      transferAmount=0;
      type_send='USDT';
    }
    else if (msg.text === 'Перевести TRX') {
      TgMessage(chatId, "Введите сумму <b>TRX</b> для отправки:",{ parse_mode: 'HTML' });
      pay_stage=1;
      transferAmount=0;
      type_send='TRX';
    }
    else if (pay_stage === 1 && transferAmount == 0 && type_send!==''){
      const inputAmount = parseFloat(msg.text);
      if (!isNaN(inputAmount) && inputAmount > 0) {
        transferAmount = inputAmount;
        TgMessage(chatId, "Сумма: <b>"+transferAmount+"</b> "+type_send+"\r\nВведите <b>Адрес</b> получателя:",{ parse_mode: 'HTML' });
        pay_stage=2;
      }
      else TgMessage(chatId, "Введите корректную сумму <u>(положительное число)</u> для отправки:");
    }
    else if (pay_stage === 2 && transferAmount>0  && type_send!==''){
      recipientAddress = msg.text;
      pay_stage=3;
       const messageText = `Отправка с кошелька:\n<code>${walletToAction}</code>\nСумма: <b>${transferAmount}</b> ${type_send}\nНа кошелек:\n<code>${recipientAddress}</code>\n<b>Все верно?</b>`;
       const options = {
            reply_markup: JSON.stringify({
              keyboard: [['Отправить'], ['Отмена']],
              resize_keyboard: true,
            }),
            parse_mode: 'HTML',
          };
       TgMessage(chatId, messageText, options);
    }
    else if(msg.text === "Список Транзакций"){
      const list = await getTransactionList(walletToAction);
      TgMessage(chatId, list);
    }
    else if(msg.text === "Отправить" && pay_stage === 3 && transferAmount>0 && recipientAddress.length>0 && type_send!==''){
      let messageText='';
      let status='';
      if(type_send === 'USDT') status = await sendUSDT(walletToAction, recipientAddress, transferAmount);
      if(type_send === 'TRX') status = await sendTRX(walletToAction, recipientAddress, transferAmount);
      if(status.status){
        const transferUrl = status.url;
        messageText = `✅ Успешная Отправка с кошелька:\n<code>${walletToAction}</code>\nСумма: <b>${transferAmount}</b> ${type_send}\nНа кошелек:\n<code>${recipientAddress}</code>\nТранзакция: ${transferUrl}`;
      }
      else{
        messageText = JSON.stringify(status.error, null, 2)+"\r\n\r\n"+status.error.toString();
      }
      TgMessage(chatId, messageText, {parse_mode: 'HTML'});
      start_keys(chatId);
    }
    else if (msg.text === 'Да') {
      if (walletToDelete) {
        const isDeleted = await deleteWallet(walletToDelete);
        if (isDeleted) {
          TgMessage(chatId, `Кошелек <code>${walletToDelete}</code> успешно удален.`, { parse_mode: 'HTML' });
           start_keys(chatId);
        } else {
          TgMessage(chatId, `Не удалось удалить кошелек <code>${walletToDelete}.</cpde>`,{ parse_mode: 'HTML' });
           start_keys(chatId);
        }
        walletToDelete = ''; // Очистите переменную после использования
      } else {
        TgMessage(chatId, 'Кошелек для удаления не выбран.');
         start_keys(chatId);
      }
    } else if (msg.text === 'Нет') {
      TgMessage(chatId, 'Действие отменено.');
      walletToDelete = ''; // Очистите переменную, если действие отменено
      start_keys(chatId);
    }
    else {
      const walletData = encryptAndDecrypt('wallets.json', secretKey, 'decrypt');
      if (walletData && Object.keys(walletData).includes(msg.text)) {

       const AddKeys = {
        reply_markup: JSON.stringify({
          keyboard: [['Перевести USDT'], ['Перевести TRX'], ['Список Транзакций'], ['Расшифровать Ключи'], ['⬅️ Назад']],
          resize_keyboard: true,
        }),
      };
       
       const balances = await getTRONBalances(msg.text);
       walletToAction = msg.text;
       TgMessage(chatId, `Выбран кошелек\r\n<code>${msg.text}</code>\r\nUSDT Баланс: <b>${balances.usdt_balance}</b>$\r\nTRX Баланс: ${balances.tron_balance}`, { parse_mode: 'HTML', ...AddKeys });
      }
    }
  }
});

// Отправка сообщений Telegram
async function TgMessage(chatId, messageText, options = {}) {
  // Добавить parse_mode: 'HTML', если его нет
  if (!options.parse_mode) {
    options.parse_mode = 'HTML';
  }

  // if (lastMessageId !== 0) {
  //   // Редактирование существующего сообщения
  //   options.chat_id = chatId;
  //   options.message_id = lastMessageId;

  //   try {
  //     await bot.editMessageText(messageText, options);
  //     return; // Если редактирование успешно, выйти из функции
  //   } catch (error) {
  //     // Если возникла ошибка, продолжить и отправить новое сообщение
  //   }
  // }

  // Отправка нового сообщения и сохранение идентификатора сообщения
  try {
    const sentMessage = await bot.sendMessage(chatId, messageText, options);
  } catch (error) {
  }
}

async function check_secret_key(chatId, message) {
  if (!message.text)  return false;
  
  const msg = message.text;
  if (msg.length === 32 && secretKey.length !== 32) {
    secretKey = msg;
    TgMessage(chatId, 'Активирован код шифрования для файлов! Работа разрешена');
    start_keys(chatId);
    // Удаление сообщения с секретным ключом
    bot.deleteMessage(chatId, message.message_id);
    return true;
  } else if (secretKey.length !== 32) {
    TgMessage(chatId, 'Отсутствует код шифрования кошельков, отправьте в ответном сообщении код для работы с ботом');
    return false;
  }
  return true;
}


async function sendUSDT(from, to, amount=null) {
  try {
    // Read wallet data from JSON file
    const walletData = encryptAndDecrypt('wallets.json', secretKey, 'decrypt');
    const privateKey = walletData[from].privateKey;

    const tronWeb = new TronWeb(fullNode, solidityNode, eventServer, privateKey);

    const usdtContract = await tronWeb.contract().at(USDT_CONTRACT_ADDRESS);

    // Retrieve the current USDT balance if the amount is null
    if (amount === null) {
      const balance = await usdtContract.balanceOf(from).call();
      amount = tronWeb.fromSun(balance);
    }

    const decimals = await usdtContract.decimals().call();
    const amountToSend = amount * 10 ** decimals;

    // Send USDT
    const transaction = await usdtContract.transfer(to, amountToSend).send({ from });

    // Get transaction receipt
    const receipt = await tronWeb.trx.getTransactionInfo(transaction);
    const energyUsed = parseInt(receipt.energy_usage_total);

    // Use the default energy price (100 SUN)
    const energyPrice = 100;

    const feeInSun = energyUsed * energyPrice;
    const feeInTRX = tronWeb.fromSun(feeInSun);

    // Log the transaction URL on Tronscan
    const tronscanUrl = `https://tronscan.org/#/transaction/${transaction}`;
    return {"status":true, "url" : tronscanUrl};

  } catch (error) {
    console.error("Error while sending USDT:", error);
    return {status:false, error: error};
  }
}

async function getTransactionList(address, limit = 20) {
  try {
    const url = `https://apilist.tronscan.org/api/transaction?address=${address}&sort=-timestamp&limit=${limit}`;
    const response = await axios.get(url);
    const transactions = response.data.data;

    let message = '';

    for (const transaction of transactions) {
      const date = new Date(transaction.timestamp);
      const formattedDate = `${date.getHours()}:${date.getMinutes()} ${date.getDate()}.${date.getMonth() + 1}.${date.getFullYear()}`;
      const type = transaction.ownerAddress === address ? '🔴' : '🟢';

      let amount, currency, counterpartyLabel, counterpartyAddress;

      if (transaction.trigger_info && transaction.trigger_info.methodName === 'transfer') {
        amount = parseInt(transaction.trigger_info.parameter._value) / 1e6;
        currency = 'USDT';
        counterpartyAddress = transaction.ownerAddress === address ? transaction.toAddress : transaction.ownerAddress;
        counterpartyLabel = transaction.ownerAddress === address ? 'Получатель' : 'Отправитель';
      } else {
        amount = transaction.amount / 1e6;
        currency = transaction.tokenInfo.tokenAbbr.toUpperCase();
        counterpartyAddress = transaction.ownerAddress === address ? transaction.toAddress : transaction.ownerAddress;
        counterpartyLabel = transaction.ownerAddress === address ? 'Получатель' : 'Отправитель';
        if (currency !== "TRX") {
          continue;
        }
      }

      const link = `<a href="https://tronscan.org/#/transaction/${transaction.hash}">TronScan</a>`;
      if(amount>0.1){
        message += `<b>${counterpartyLabel}</b>: <code>${counterpartyAddress}</code>\n<code>|</code> <i>${formattedDate}</i> <code>|</code> ${type} <code>|</code> <b>${amount} ${currency}</b> <code>|</code> ${link}\n---------------------\n`;
      }
    }

    return message;
  } catch (error) {
    console.error('Error:', error);
    return 'Ошибка при получении списка транзакций.';
  }
}





async function sendTRX(from, to, amount=null) {
  try {
    // Read wallet data from JSON file
    const walletData = encryptAndDecrypt('wallets.json', secretKey, 'decrypt');
    const privateKey = walletData[from].privateKey;

    const tronWeb = new TronWeb(fullNode, solidityNode, eventServer, privateKey);

    // Retrieve the current TRX balance if the amount is null
    if (amount === null) {
      const balance = await tronWeb.trx.getBalance(from);
      amount = tronWeb.fromSun(balance);
    }

    // Convert the amount to SUN
    const amountToSend = tronWeb.toSun(amount);

    // Send TRX
    const transaction = await tronWeb.trx.sendTransaction(to, amountToSend, privateKey);

    // Get transaction receipt
    const receipt = await tronWeb.trx.getTransactionInfo(transaction.txid);
    const energyUsed = parseInt(receipt.energy_usage_total);

    // Use the default energy price (100 SUN)
    const energyPrice = 100;

    const feeInSun = energyUsed * energyPrice;
    const feeInTRX = tronWeb.fromSun(feeInSun);

    // Log the transaction URL on Tronscan
    const tronscanUrl = `https://tronscan.org/#/transaction/${transaction.txid}`;
    return {"status":true, "url" : tronscanUrl};

  } catch (error) {
    console.error("Error while sending TRX:", error);
    return {status:false, error: error};
  }
}


async function getTRONBalances(walletAddress) {

  const walletData = encryptAndDecrypt('wallets.json', secretKey, 'decrypt');
  const privateKey = walletData[walletAddress].privateKey;


  const tronWeb = new TronWeb(fullNode, solidityNode, eventServer,privateKey);

  try {
    const tronBalance = await tronWeb.trx.getBalance(walletAddress);
    const tronBalanceInTRX = tronWeb.fromSun(tronBalance);
    const usdtContractAddress = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'; // USDT-TRON contract address
    const usdtContract = await tronWeb.contract().at(usdtContractAddress);
    const usdtBalance = await usdtContract.balanceOf(walletAddress).call();
    const usdtBalanceInUSDT = (usdtBalance / 1e6).toFixed(2);

    return {
      usdt_balance: usdtBalanceInUSDT,
      tron_balance: tronBalanceInTRX,
    };
  } catch (error) {
    console.error('Error while fetching TRON balances:', error);
    return {
      usdt_balance: null,
      tron_balance: null,
    };
  }
}

function start_keys(chatId) {

      pay_stage=0;
      recipientAddress='';
      transferAmount=0;
      walletToAction='';
      type_send='';

  const menuOptions = {
    reply_markup: JSON.stringify({
      keyboard: [
        ['Список кошельков'],
        ['Создать кошелек'],
        ['Удалить кошелек'],
        ['Заблокировать бота']
      ],
      resize_keyboard: true
    })
  };
  TgMessage(chatId, 'Выберите действие:', menuOptions);
}



async function GetWallet(walletAddress) {
  let walletData;
  if (fs.existsSync('wallets.json')) {
    walletData = encryptAndDecrypt('wallets.json', secretKey, 'decrypt');
    return walletData[walletAddress];
  } else {
    return false;
  }
}

async function deleteWallet(walletAddress) {
  let walletData;
  if (fs.existsSync('wallets.json')) {
    walletData = encryptAndDecrypt('wallets.json', secretKey, 'decrypt');
  } else {
    walletData = {};
  }

  if (walletData.hasOwnProperty(walletAddress)) {
    delete walletData[walletAddress];
    encryptAndDecrypt('wallets.json', secretKey, 'encrypt', walletData);
    return true;
  }

  return false;
}

async function generateWallet(secretKey) {
  let walletData;

  // Check if the wallets file exists
  if (fs.existsSync("wallets.json")) {
    // Decrypt the wallet file
    walletData = encryptAndDecrypt("wallets.json", secretKey, 'decrypt');
  } else {
    walletData = {};
  }

  // Generate a new wallet
  const newWallet = await TronWeb.createAccount();

  // Add the new wallet to the existing data
  walletData[newWallet.address.base58] = newWallet;

  // Encrypt the updated wallet data
  encryptAndDecrypt("wallets.json", secretKey, 'encrypt', walletData);
  return newWallet.address.base58;
}

// Шифрования/Расшифровка Файла
function encryptAndDecrypt(filePath, secretKey, mode, dataToEncrypt) {
  try {
    const cipherFunction = mode === 'decrypt' ? crypto.createDecipheriv : crypto.createCipheriv;
    const cipher = cipherFunction("aes-256-cbc", secretKey, Buffer.alloc(16, 0));

    if (mode === 'decrypt') {
      const data = fs.readFileSync(filePath);
      const processedData = Buffer.concat([cipher.update(data), cipher.final()]);
      return JSON.parse(processedData.toString("utf-8"));
    } else {
      const processedData = Buffer.concat([cipher.update(JSON.stringify(dataToEncrypt, null, 2), "utf-8"), cipher.final()]);
      fs.writeFileSync(filePath, processedData);
    }
  } catch (error) {
    console.error("Ошибка при шифровании/дешифровании файла:", error.message);
    return mode === 'decrypt' ? null : false;
  }
}

